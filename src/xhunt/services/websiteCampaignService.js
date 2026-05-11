const axios = require("axios");
const { Op } = require("sequelize");
const { XHuntWebsiteCampaign, pgInstance } = require("../../models/postgres-start");
const LEGACY_WEBSITE_CAMPAIGNS = require("../constants/legacyWebsiteCampaigns");

const CAMPAIGN_CONFIG_URL =
  "https://kb.xhunt.ai/nacos-configs?dataId=xhunt_campaigns&group=DEFAULT_GROUP";

const WEBSITE_STATUS_VALUES = new Set([
  "draft",
  "coming_soon",
  "live",
  "claim",
  "ended",
  "archived",
]);

function toSafeObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function trimOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSlug(campaignKey) {
  return String(campaignKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeWebsiteStatus(value) {
  if (!value) return "draft";
  const normalized = String(value).trim().toLowerCase();
  return WEBSITE_STATUS_VALUES.has(normalized) ? normalized : "draft";
}

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeNacosCampaign(campaign) {
  const displayName = toSafeObject(campaign.displayName);
  const projectIntroduction = toSafeObject(campaign.projectIntroduction);
  const enrollmentWindow = toSafeObject(campaign.enrollmentWindow);
  const links = toSafeObject(campaign.links);

  return {
    nacosCampaignId: String(campaign.id || "").trim(),
    campaignKey: String(campaign.campaignKey || "").trim(),
    slug: normalizeSlug(campaign.campaignKey || campaign.id || ""),
    enabled: !!campaign.enabled,
    testingPhase: !!campaign.testingPhase,
    sortWeight: Number.isFinite(Number(campaign.sortWeight))
      ? Number(campaign.sortWeight)
      : 0,
    displayNameZh: trimOrNull(displayName.zh),
    displayNameEn: trimOrNull(displayName.en),
    projectIntroductionZh: trimOrNull(projectIntroduction.zh),
    projectIntroductionEn: trimOrNull(projectIntroduction.en),
    startAt: parseDateOrNull(enrollmentWindow.startAt),
    endAt: parseDateOrNull(enrollmentWindow.endAt),
    rewardAmount:
      campaign.rewardAmount === undefined || campaign.rewardAmount === null
        ? null
        : String(campaign.rewardAmount),
    rewardParticipantCount: Number.isFinite(Number(campaign.rewardParticipantCount))
      ? Number(campaign.rewardParticipantCount)
      : null,
    rewardUnit: trimOrNull(campaign.rewardUnit),
    guideUrl: trimOrNull(links.guideUrl),
    activeUrl: trimOrNull(links.activeUrl),
    logos: toSafeArray(campaign.logos),
    tags: toSafeArray(campaign.tags),
    writingThemes: toSafeArray(campaign.writingThemes),
    nacosPayload: campaign,
  };
}

function getSyncedPayload(recordLike) {
  return {
    nacosCampaignId: recordLike.nacosCampaignId,
    campaignKey: recordLike.campaignKey,
    slug: recordLike.slug,
    enabled: !!recordLike.enabled,
    testingPhase: !!recordLike.testingPhase,
    sortWeight: Number(recordLike.sortWeight || 0),
    displayNameZh: recordLike.displayNameZh || null,
    displayNameEn: recordLike.displayNameEn || null,
    projectIntroductionZh: recordLike.projectIntroductionZh || null,
    projectIntroductionEn: recordLike.projectIntroductionEn || null,
    startAt: recordLike.startAt ? new Date(recordLike.startAt).toISOString() : null,
    endAt: recordLike.endAt ? new Date(recordLike.endAt).toISOString() : null,
    rewardAmount: recordLike.rewardAmount != null ? String(recordLike.rewardAmount) : null,
    rewardParticipantCount: recordLike.rewardParticipantCount ?? null,
    rewardUnit: recordLike.rewardUnit || null,
    guideUrl: recordLike.guideUrl || null,
    activeUrl: recordLike.activeUrl || null,
    logos: toSafeArray(recordLike.logos),
    tags: toSafeArray(recordLike.tags),
    writingThemes: toSafeArray(recordLike.writingThemes),
    nacosPayload: toSafeObject(recordLike.nacosPayload, {}),
  };
}

async function fetchNacosCampaigns() {
  const resp = await axios.get(CAMPAIGN_CONFIG_URL, { timeout: 10000 });
  const data = resp?.data;
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : null;
  if (!campaigns) {
    throw new Error("Nacos campaigns config is incomplete");
  }
  return campaigns;
}

function buildSyncDiff(existing, nextPayload) {
  if (!existing) return { changed: true, reason: "created" };
  const current = getSyncedPayload(existing);
  const changed = JSON.stringify(current) !== JSON.stringify(getSyncedPayload(nextPayload));
  return { changed, reason: changed ? "updated" : "unchanged" };
}

async function syncCampaignsFromNacos({ dryRun = false } = {}) {
  const nacosCampaigns = await fetchNacosCampaigns();
  const normalizedCampaigns = nacosCampaigns
    .map(normalizeNacosCampaign)
    .filter((item) => item.nacosCampaignId && item.campaignKey);

  const existingRecords = await XHuntWebsiteCampaign.findAll();
  const existingMap = new Map(
    existingRecords.map((item) => [String(item.nacosCampaignId), item])
  );
  const incomingIds = new Set(normalizedCampaigns.map((item) => item.nacosCampaignId));

  const summary = {
    totalInNacos: normalizedCampaigns.length,
    created: 0,
    updated: 0,
    restored: 0,
    softDeleted: 0,
    unchanged: 0,
  };
  const items = {
    created: [],
    updated: [],
    restored: [],
    softDeleted: [],
    unchanged: [],
  };

  const run = async (transaction) => {
    for (const campaign of normalizedCampaigns) {
      const existing = existingMap.get(campaign.nacosCampaignId);
      const diff = buildSyncDiff(existing, campaign);
      const key = campaign.campaignKey || campaign.nacosCampaignId;

      if (!existing) {
        summary.created += 1;
        items.created.push(key);
        if (!dryRun) {
          await XHuntWebsiteCampaign.create(
            {
              ...campaign,
              webStatus: "draft",
              pageTemplate: "standard",
              templateConfig: {},
              websiteExtra: {},
              isDeleted: false,
              deletedAt: null,
              lastSyncedAt: new Date(),
            },
            { transaction }
          );
        }
        continue;
      }

      if (existing.isDeleted) {
        summary.restored += 1;
        items.restored.push(key);
      }

      if (diff.changed || existing.isDeleted) {
        summary.updated += diff.changed ? 1 : 0;
        if (diff.changed) items.updated.push(key);
        if (!dryRun) {
          await existing.update(
            {
              ...campaign,
              isDeleted: false,
              deletedAt: null,
              lastSyncedAt: new Date(),
            },
            { transaction }
          );
        }
      } else {
        summary.unchanged += 1;
        items.unchanged.push(key);
        if (!dryRun) {
          await existing.update(
            {
              lastSyncedAt: new Date(),
            },
            { transaction }
          );
        }
      }
    }

    for (const existing of existingRecords) {
      if (!incomingIds.has(String(existing.nacosCampaignId))) {
        summary.softDeleted += 1;
        items.softDeleted.push(existing.campaignKey || existing.nacosCampaignId);
        if (!dryRun) {
          await existing.update(
            {
              isDeleted: true,
              deletedAt: new Date(),
              lastSyncedAt: new Date(),
            },
            { transaction }
          );
        }
      }
    }
  };

  if (dryRun) {
    await run(null);
  } else {
    await pgInstance.transaction(async (transaction) => {
      await run(transaction);
    });
  }

  return { summary, items };
}

function formatRewardText(record, lang = "zh-CN") {
  if (lang === "en" && record.webRewardTextEn) return record.webRewardTextEn;
  if (lang !== "en" && record.webRewardTextZh) return record.webRewardTextZh;

  const unit = record.rewardUnit || "";
  const amount = record.rewardAmount != null ? String(record.rewardAmount).replace(/\.0+$/, "") : "";
  if (amount && unit) {
    return lang === "en" ? `Reward: ${amount} ${unit}` : `奖池：${amount} ${unit}`;
  }
  if (amount) {
    return lang === "en" ? `Reward: ${amount}` : `奖池：${amount}`;
  }
  return "";
}

function getLocaleValue(record, zhField, enField, lang = "zh-CN") {
  if (lang === "en") return record[enField] || record[zhField] || null;
  return record[zhField] || record[enField] || null;
}

function buildTitle(record, lang = "zh-CN") {
  return (
    (lang === "en" ? record.displayNameEn : record.displayNameZh) ||
    record.displayNameZh ||
    record.displayNameEn ||
    record.campaignKey ||
    record.slug
  );
}

function getButtonTextByStatus(status, lang = "zh-CN") {
  const isZh = lang !== "en";
  if (status === "coming_soon") return isZh ? "敬请期待" : "Coming Soon";
  if (status === "claim") return isZh ? "立即领取" : "Claim Now";
  if (status === "ended") return isZh ? "已结束" : "Ended";
  return isZh ? "查看详情" : "View Details";
}

function getCardStyleByStatus(status) {
  if (status === "coming_soon") return "coming_soon";
  if (status === "claim") return "claim";
  if (status === "ended") return "ended";
  return "live";
}

function getSortBucket(status) {
  if (status === "coming_soon") return 4000000000;
  if (status === "live") return 3000000000;
  if (status === "claim") return 2000000000;
  if (status === "ended") return 1000000000;
  return 0;
}

function deriveSortOrder(record) {
  const bucket = getSortBucket(record.webStatus);
  const weight = Number(record.sortWeight || 0) * 100000;
  const startAtTs = record.startAt ? new Date(record.startAt).getTime() : 0;
  return bucket + weight + Math.floor(startAtTs / 1000);
}

function pickLogos(record) {
  const logos = toSafeArray(record.logos);
  const left = logos[0] || null;
  const right = logos[1] || null;
  return {
    leftLogo: left?.image || null,
    rightLogo: right?.image || null,
  };
}

function buildCampaignListItem(record, lang = "zh-CN") {
  const { leftLogo, rightLogo } = pickLogos(record);
  const status = normalizeWebsiteStatus(record.webStatus);
  return {
    id: record.id,
    nacosCampaignId: record.nacosCampaignId,
    campaignKey: record.campaignKey,
    slug: record.slug,
    title: buildTitle(record, lang),
    announcement:
      getLocaleValue(record, "webAnnouncementZh", "webAnnouncementEn", lang) ||
      getLocaleValue(record, "projectIntroductionZh", "projectIntroductionEn", lang) ||
      "",
    rewardText: formatRewardText(record, lang),
    note: getLocaleValue(record, "webNoteZh", "webNoteEn", lang),
    status,
    buttonText: getButtonTextByStatus(status, lang),
    cardStyle: getCardStyleByStatus(status),
    leftLogo,
    rightLogo,
    sortOrder: deriveSortOrder(record),
    startAt: record.startAt,
    endAt: record.endAt,
  };
}

function buildCampaignDetail(record, lang = "zh-CN") {
  return {
    id: record.id,
    nacosCampaignId: record.nacosCampaignId,
    campaignKey: record.campaignKey,
    slug: record.slug,
    title: buildTitle(record, lang),
    summary:
      getLocaleValue(record, "webAnnouncementZh", "webAnnouncementEn", lang) ||
      getLocaleValue(record, "projectIntroductionZh", "projectIntroductionEn", lang) ||
      buildTitle(record, lang),
    description:
      getLocaleValue(record, "projectIntroductionZh", "projectIntroductionEn", lang) ||
      getLocaleValue(record, "webAnnouncementZh", "webAnnouncementEn", lang) ||
      "",
    webStatus: normalizeWebsiteStatus(record.webStatus),
    buttonText: getButtonTextByStatus(record.webStatus, lang),
    guideUrl: record.guideUrl,
    activeUrl: record.activeUrl,
    startAt: record.startAt,
    endAt: record.endAt,
    logos: toSafeArray(record.logos),
    reward: {
      text: formatRewardText(record, lang),
      amount: record.rewardAmount,
      unit: record.rewardUnit,
    },
    claim: {
      poiContractAddress: record.claimPoiContractAddress,
      powContractAddress: record.claimPowContractAddress,
      essayContractAddress: record.claimEssayContractAddress,
    },
    pageTemplate: record.pageTemplate || "standard",
    templateConfig: toSafeObject(record.templateConfig, {}),
    nacosPayload: toSafeObject(record.nacosPayload, {}),
  };
}

async function listPublicCampaigns({ lang = "zh-CN" } = {}) {
  const where = {
    webStatus: { [Op.notIn]: ["draft", "archived"] },
  };
  const records = await XHuntWebsiteCampaign.findAll({ where });
  return records
    .map((record) => buildCampaignListItem(record, lang))
    .sort((a, b) => b.sortOrder - a.sortOrder);
}

async function getPublicCampaignDetailBySlug(slug, { lang = "zh-CN" } = {}) {
  const record = await XHuntWebsiteCampaign.findOne({
    where: {
      slug,
      webStatus: { [Op.notIn]: ["draft", "archived"] },
    },
  });
  if (!record) return null;
  return buildCampaignDetail(record, lang);
}

async function getWebsiteCampaignAdminByNacosId(nacosCampaignId) {
  return XHuntWebsiteCampaign.findOne({ where: { nacosCampaignId } });
}

function validateContractAddress(value, label) {
  if (!value) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value).trim())) {
    throw new Error(`${label} 格式不正确，必须是合法 EVM 地址`);
  }
}

async function saveWebsiteCampaignConfig(nacosCampaignId, payload) {
  return pgInstance.transaction(async (transaction) => {
    const record = await XHuntWebsiteCampaign.findOne({
      where: { nacosCampaignId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) {
      throw new Error("请先同步到网站数据库后再保存网站配置");
    }

    const nextStatus = normalizeWebsiteStatus(payload.webStatus || record.webStatus);
    const nextPageTemplate = trimOrNull(payload.pageTemplate) || record.pageTemplate || "standard";
    const nextSlug = trimOrNull(payload.slug) || record.slug || normalizeSlug(record.campaignKey || nacosCampaignId);

    const existedSlug = await XHuntWebsiteCampaign.findOne({
      where: {
        slug: nextSlug,
        nacosCampaignId: { [Op.ne]: nacosCampaignId },
      },
      transaction,
    });
    if (existedSlug) {
      throw new Error("slug 已被其他活动使用，请更换后再保存");
    }

    const nextValues = {
      slug: nextSlug,
      webStatus: nextStatus,
      webAnnouncementZh: trimOrNull(payload.webAnnouncementZh),
      webAnnouncementEn: trimOrNull(payload.webAnnouncementEn),
      webRewardTextZh: trimOrNull(payload.webRewardTextZh),
      webRewardTextEn: trimOrNull(payload.webRewardTextEn),
      webNoteZh: trimOrNull(payload.webNoteZh),
      webNoteEn: trimOrNull(payload.webNoteEn),
      claimPoiContractAddress: trimOrNull(payload.claimPoiContractAddress),
      claimPowContractAddress: trimOrNull(payload.claimPowContractAddress),
      claimEssayContractAddress: trimOrNull(payload.claimEssayContractAddress),
      pageTemplate: nextPageTemplate,
      templateConfig: toSafeObject(payload.templateConfig, {}),
      websiteExtra: toSafeObject(payload.websiteExtra, record.websiteExtra || {}),
    };

    validateContractAddress(nextValues.claimPoiContractAddress, "POI 合约地址");
    validateContractAddress(nextValues.claimPowContractAddress, "POW 合约地址");
    validateContractAddress(nextValues.claimEssayContractAddress, "征文大赛合约地址");

    if (nextStatus === "claim") {
      if (!nextValues.claimPoiContractAddress) {
        throw new Error("claim 状态下必须填写 POI 合约地址");
      }
      const nacosPayload = toSafeObject(record.nacosPayload, {});
      if (nacosPayload.enablePowLeaderboard === true && !nextValues.claimPowContractAddress) {
        throw new Error("当前活动已开启 POW，claim 状态下必须填写 POW 合约地址");
      }
      if (nacosPayload.enableEssayContest === true && !nextValues.claimEssayContractAddress) {
        throw new Error("当前活动已开启征文大赛，claim 状态下必须填写征文大赛合约地址");
      }
    }

    await record.update(nextValues, { transaction });
    return record;
  });
}


async function listAllWebsiteCampaignsAdmin() {
  const records = await XHuntWebsiteCampaign.findAll();
  return records
    .map((record) => ({
      ...record.toJSON(),
      groupType: record.isDeleted ? "website_only" : "nacos_active",
    }))
    .sort((a, b) => {
      if (a.isDeleted !== b.isDeleted) return a.isDeleted ? 1 : -1;
      const wa = Number(a.sortWeight || 0);
      const wb = Number(b.sortWeight || 0);
      if (wa !== wb) return wb - wa;
      return String(a.campaignKey || a.slug).localeCompare(String(b.campaignKey || b.slug));
    });
}

async function importLegacyWebsiteCampaigns() {
  const summary = { created: 0, skipped: 0, updatedDeleted: 0 };
  return pgInstance.transaction(async (transaction) => {
    for (const item of LEGACY_WEBSITE_CAMPAIGNS) {
      const existed = await XHuntWebsiteCampaign.findOne({
        where: {
          [Op.or]: [
            { nacosCampaignId: item.nacosCampaignId },
            { slug: item.slug },
          ],
        },
        transaction,
      });

      if (!existed) {
        await XHuntWebsiteCampaign.create(
          {
            nacosCampaignId: item.nacosCampaignId,
            campaignKey: item.campaignKey,
            slug: item.slug,
            isDeleted: true,
            deletedAt: new Date(),
            lastSyncedAt: null,
            enabled: false,
            testingPhase: false,
            sortWeight: item.sortWeight || 0,
            displayNameZh: item.displayNameZh || null,
            displayNameEn: item.displayNameEn || null,
            projectIntroductionZh: item.webAnnouncementZh || null,
            projectIntroductionEn: item.webAnnouncementEn || null,
            rewardUnit: null,
            guideUrl: null,
            activeUrl: null,
            logos: item.logos || [],
            tags: [],
            writingThemes: [],
            nacosPayload: {},
            webStatus: "draft",
            webAnnouncementZh: item.webAnnouncementZh || null,
            webAnnouncementEn: item.webAnnouncementEn || null,
            webRewardTextZh: item.webRewardTextZh || null,
            webRewardTextEn: item.webRewardTextEn || null,
            webNoteZh: item.webNoteZh || null,
            webNoteEn: item.webNoteEn || null,
            pageTemplate: "standard",
            templateConfig: {},
            websiteExtra: { importedFrom: "legacy-static-data" },
          },
          { transaction }
        );
        summary.created += 1;
        continue;
      }

      if (!existed.isDeleted) {
        summary.skipped += 1;
        continue;
      }

      await existed.update(
        {
          displayNameZh: existed.displayNameZh || item.displayNameZh || null,
          displayNameEn: existed.displayNameEn || item.displayNameEn || null,
          projectIntroductionZh: existed.projectIntroductionZh || item.webAnnouncementZh || null,
          projectIntroductionEn: existed.projectIntroductionEn || item.webAnnouncementEn || null,
          logos: Array.isArray(existed.logos) && existed.logos.length ? existed.logos : (item.logos || []),
          webAnnouncementZh: existed.webAnnouncementZh || item.webAnnouncementZh || null,
          webAnnouncementEn: existed.webAnnouncementEn || item.webAnnouncementEn || null,
          webRewardTextZh: existed.webRewardTextZh || item.webRewardTextZh || null,
          webRewardTextEn: existed.webRewardTextEn || item.webRewardTextEn || null,
          webNoteZh: existed.webNoteZh || item.webNoteZh || null,
          webNoteEn: existed.webNoteEn || item.webNoteEn || null,
          websiteExtra: {
            ...(existed.websiteExtra || {}),
            importedFrom: "legacy-static-data",
          },
        },
        { transaction }
      );
      summary.updatedDeleted += 1;
    }
    return summary;
  });
}

module.exports = {
  WEBSITE_STATUS_VALUES,
  normalizeWebsiteStatus,
  fetchNacosCampaigns,
  syncCampaignsFromNacos,
  listPublicCampaigns,
  getPublicCampaignDetailBySlug,
  getWebsiteCampaignAdminByNacosId,
  saveWebsiteCampaignConfig,
  buildCampaignDetail,
  listAllWebsiteCampaignsAdmin,
  importLegacyWebsiteCampaigns,
};
