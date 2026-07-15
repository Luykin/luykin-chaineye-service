const express = require("express");
const axios = require("axios");
const { Op } = require("sequelize");
const crypto = require("crypto");
const {
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
} = require("../middleware/security");
const {
  authenticateToken,
  authenticateTokenOptional,
} = require("../middleware/auth");
const {
  CampaignRegistration,
  XHuntUser,
  XHuntBinanceSquareBinding,
} = require("../../models/postgres-start");
const {
  getManagedCampaignPayloadByKey,
  listPluginCampaigns,
} = require("../services/websiteCampaignService");
const {
  getCachedPluginCampaigns,
} = require("../utils/campaign-config-cache");
const {
  RANK_API_BY_DOMAIN,
  normalizeCampaignIdentifier,
  normalizeCreatorAuthPayload,
  normalizeRegistrationContact,
  rankResultMeetsThreshold,
  loadCampaignConfigForRegistration,
  registerCampaignParticipant,
} = require("../services/campaignRegistrationService");
const {
  getCustomLeaderboardData,
  getCustomUserActivityData,
  isYziLabsCampaign,
} = require("../services/campaignLeaderboardService");
const { parseUtcDateParam } = require("../utils/date");
const { isVersionGreaterOrEqual } = require("../utils/version");
const { adminAuth, requirePermission, requireRole } = require("../../admin/middleware/adminAuth");

const router = express.Router();

const MIN_EXTENSION_VERSION = "0.3.0";
const XHUNT_EXTENSION_UPDATE_URL =
  "https://chromewebstore.google.com/detail/xhunt-%E2%80%93-your-ai-co-pilot/gonmfafjcdkngkbhcpmcphlgfhabkeji";

function buildExtensionUpdateRequiredResponse({
  minVersion = MIN_EXTENSION_VERSION,
  updateUrl = XHUNT_EXTENSION_UPDATE_URL,
  message,
} = {}) {
  return {
    success: false,
    code: "EXTENSION_UPDATE_REQUIRED",
    force_update: true,
    min_version: minVersion,
    update_url: updateUrl,
    message: message || {
      zh: "当前插件版本过低，请更新 XHunt 插件后再报名。",
      en: "Your XHunt extension is out of date. Please update it before signing up.",
    },
  };
}


function normalizeCampaign(raw) {
  if (!raw || typeof raw !== "string") return null;
  return raw.trim();
}

function normalizeTesterHandle(value) {
  if (Array.isArray(value)) return normalizeTesterHandle(value[0]);
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function isCampaignTester(campaign, requestHandleOrViewer) {
  if (!campaign || !requestHandleOrViewer) return false;
  const list = Array.isArray(campaign.testList) ? campaign.testList : [];
  const requestIdentifiers = typeof requestHandleOrViewer === "object"
    ? [requestHandleOrViewer.username, requestHandleOrViewer.twitterId]
    : [requestHandleOrViewer];
  const normalized = requestIdentifiers.map(normalizeTesterHandle).filter(Boolean);
  if (!normalized.length) return false;
  return list.some((item) => normalized.includes(normalizeTesterHandle(item)));
}

const CAMPAIGN_DISPLAY_DOMAINS = new Set(["web3", "ai"]);
function normalizeDisplayDomain(value) {
  if (Array.isArray(value)) return normalizeDisplayDomain(value[0]);
  if (value === null || value === undefined || value === "") return "";
  const normalized = String(value).trim().toLowerCase();
  return CAMPAIGN_DISPLAY_DOMAINS.has(normalized) ? normalized : null;
}

function getCampaignDisplayDomains(campaign) {
  const list = Array.isArray(campaign?.displayDomains)
    ? campaign.displayDomains
    : ["web3"];
  const domains = list
    .map((item) => normalizeDisplayDomain(item))
    .filter(Boolean);
  return domains.length ? domains : ["web3"];
}

function matchesDisplayDomain(campaign, domain) {
  if (!domain) return true;
  return getCampaignDisplayDomains(campaign).includes(domain);
}

function setCampaignConfigCacheHeaders(res) {
  // 按 domain / x-user-id / Authorization 可能返回不同活动，不让浏览器强缓存空结果；
  // 服务端仍通过 Redis 缓存活动列表，避免每次都打数据库。
  res.set("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
  res.set("Expires", "0");
  res.set("Vary", "x-user-id, Authorization");
}

function getCustomLeaderboardsFromCampaign(campaignConfig) {
  if (campaignConfig?.leaderboardMode !== "custom") return [];
  return Array.isArray(campaignConfig.customLeaderboards)
    ? campaignConfig.customLeaderboards
    : [];
}

function serializeInternalCampaignConfig(campaign) {
  if (!campaign || typeof campaign !== "object") return campaign;
  const {
    testList: _testList,
    tags: _tags,
    tasks: _tasks,
    copy: _copy,
    customLeaderboards: _customLeaderboards,
    ...safeCampaign
  } = campaign;
  return safeCampaign;
}

async function getCustomCampaignConfig(campaign, req) {
  const found = await getManagedCampaignPayloadByKey(campaign, {
    includeTesting: true,
    channel: "plugin",
  });
  if (!found || !found.enabled) return null;
  if (found.testingPhase) {
    const requestHandle = normalizeTesterHandle(req?.headers?.["x-user-id"]);
    const requestTwitterId = normalizeTesterHandle(req?.headers?.["x-tw-id"] || req?.user?.twitterId);
    // 测试阶段活动的可见性只由活动自己的 testList 控制：
    // 命中 testList 的用户可见，未命中则不可见，不再额外要求 internal_test。
    const allowed = isCampaignTester(found, {
      username: requestHandle,
      twitterId: requestTwitterId,
    });
    if (!allowed) return null;
  }
  return found;
}

router.get("/config", securityMiddleware, authenticateTokenOptional, async (req, res) => {
  try {
    const requestHandle = normalizeTesterHandle(req.headers["x-user-id"]);
    const requestTwitterId = normalizeTesterHandle(req.headers["x-tw-id"] || req.user?.twitterId);
    const requestedDomain = normalizeDisplayDomain(
      req.query.domain || req.query.displayDomain,
    );
    if (requestedDomain === null) {
      return res.status(400).json({
        success: false,
        error: "Invalid domain. Supported values: web3, ai",
      });
    }

    if (!requestHandle && !requestTwitterId) {
      res.set("Cache-Control", "no-store");
      return res.json({
        success: true,
        version: 3,
        source: "database",
        domain: requestedDomain || null,
        includeTesting: false,
        campaigns: [],
      });
    }

    const allCampaigns = await getCachedPluginCampaigns(req.redisClient, () =>
      listPluginCampaigns({ includeTesting: true })
    );
    let includeTesting = false;
    const campaigns = allCampaigns.filter((campaign) => {
      if (!matchesDisplayDomain(campaign, requestedDomain)) return false;
      if (!campaign.testingPhase) return true;
      // 测试阶段活动按活动配置的 testList 精准放行。
      // testList 支持 username / twitterId；不再叠加 internal_test 白名单判断。
      const allowed = isCampaignTester(campaign, {
        username: requestHandle,
        twitterId: requestTwitterId,
      });
      if (allowed) includeTesting = true;
      return allowed;
    });

    const payload = {
      success: true,
      version: 3,
      source: "database",
      domain: requestedDomain || null,
      includeTesting,
      campaigns,
    };

    setCampaignConfigCacheHeaders(res);
    return res.json(payload);
  } catch (error) {
    console.error("[CampaignConfig] error:", error.message || error);
    return res.status(500).json({ success: false, error: "获取活动配置失败" });
  }
});

// 内部配置接口：不走插件安全签名/登录校验。
// 不按 domain / webStatus / enabled 过滤；返回 isDeleted=false 的活动，包含测试中的活动。
router.get("/internal/hK9N7y37rPa1/config", async (req, res) => {
  try {
    const allCampaigns = await listPluginCampaigns({
      includeTesting: true,
      includeDisabled: true,
    });

    return res.json({
      version: 3,
      campaigns: allCampaigns.map(serializeInternalCampaignConfig),
    });
  } catch (error) {
    console.error("[CampaignInternalConfig] error:", error.message || error);
    return res.status(500).json({ success: false, error: "获取活动配置失败" });
  }
});

router.get("/custom-leaderboard", securityMiddleware, async (req, res) => {
  try {
    const normalizedCampaign = normalizeCampaign(req.query.campaign);
    if (!normalizedCampaign) {
      return res.status(400).json({ success: false, error: "campaign is required" });
    }

    const campaignConfig = await getCustomCampaignConfig(normalizedCampaign, req);
    if (!campaignConfig) {
      return res.status(404).json({ success: false, error: "Campaign not found" });
    }

    const customLeaderboards = getCustomLeaderboardsFromCampaign(campaignConfig);
    if (!customLeaderboards.length) {
      return res.status(400).json({
        success: false,
        error: "Campaign is not configured with custom leaderboards",
      });
    }

    const data = await getCustomLeaderboardData(campaignConfig, {
      campaign: normalizedCampaign,
      channel: "plugin",
    });

    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      campaign: normalizedCampaign,
      updatedAt: data.updatedAt,
      leaderboards: data.leaderboards || {},
    });
  } catch (err) {
    console.error("[CustomLeaderboard] error:", err.message || err);
    return res.status(502).json({
      success: false,
      error: "Failed to fetch custom leaderboard",
    });
  }
});

router.get("/custom-user-activity", securityMiddleware, authenticateTokenOptional, async (req, res) => {
  try {
    const normalizedCampaign = normalizeCampaign(req.query.campaign);
    const userId = req.query.userid || req.query.userId;
    if (!normalizedCampaign) {
      return res.status(400).json({ success: false, error: "campaign is required" });
    }

    const campaignConfig = await getCustomCampaignConfig(normalizedCampaign, req);
    if (!campaignConfig) {
      return res.status(404).json({ success: false, error: "Campaign not found" });
    }

    const customLeaderboards = getCustomLeaderboardsFromCampaign(campaignConfig);
    if (!customLeaderboards.length) {
      return res.status(400).json({
        success: false,
        error: "Campaign is not configured with custom leaderboards",
      });
    }

    const yziLabsCampaign = isYziLabsCampaign(normalizedCampaign);
    if (!userId && !yziLabsCampaign) {
      return res.status(400).json({ success: false, error: "userid is required" });
    }

    // YZi Labs 个人排名：只用 Twitter ID 匹配榜单 t_twitter_id；
    // 已登录优先用 XHuntUser.twitterId，未登录退回 x-tw-id。
    // 匹配不到则视为未上榜，不再使用 username 兜底。
    const twitterId = String(req.user?.twitterId || req.headers["x-tw-id"] || "").trim();

    if (yziLabsCampaign && !twitterId) {
      return res.status(400).json({ success: false, error: "twitter identity is required" });
    }

    const data = await getCustomUserActivityData(campaignConfig, userId, {
      campaign: normalizedCampaign,
      channel: "plugin",
      twitterId,
    });

    res.set("Cache-Control", "private, max-age=300");
    res.set("Vary", "Authorization, x-tw-id, x-user-id");
    return res.json({
      success: true,
      campaign: normalizedCampaign,
      userid: userId ? String(userId) : "",
      updatedAt: data.updatedAt,
      leaderboards: data.leaderboards || {},
    });
  } catch (err) {
    console.error("[CustomUserActivity] error:", err.message || err);
    return res.status(502).json({
      success: false,
      error: "Failed to fetch custom user activity",
    });
  }
});



function serializeBinanceSquareAccount(record) {
  if (!record) return null;
  const row = typeof record.toJSON === "function" ? record.toJSON() : record;
  return {
    id: row.id,
    twitterId: row.twitterId,
    binanceSquareUid: row.binanceSquareUid,
    binanceUsername: row.binanceUsername,
    binanceDisplayName: row.binanceDisplayName || null,
    binanceAvatar: row.binanceAvatar || null,
    verificationPostUrl: row.verificationPostUrl || null,
    verifiedAt: row.verifiedAt || null,
    status: row.status || null,
  };
}

async function loadBinanceSquareAccountMap(registrationRows) {
  const twitterIds = Array.from(
    new Set(
      (registrationRows || [])
        .map((record) => {
          const row = typeof record?.toJSON === "function" ? record.toJSON() : record;
          return row?.twitterId ? String(row.twitterId).trim() : "";
        })
        .filter(Boolean)
    )
  );

  if (twitterIds.length === 0) return new Map();

  const bindings = await XHuntBinanceSquareBinding.findAll({
    where: {
      twitterId: { [Op.in]: twitterIds },
      status: "active",
    },
    attributes: [
      "id",
      "twitterId",
      "binanceSquareUid",
      "binanceUsername",
      "binanceDisplayName",
      "binanceAvatar",
      "verificationPostUrl",
      "verifiedAt",
      "status",
    ],
    order: [
      ["verifiedAt", "DESC"],
      ["createdAt", "DESC"],
    ],
  });

  const map = new Map();
  for (const binding of bindings) {
    const account = serializeBinanceSquareAccount(binding);
    if (account?.twitterId && !map.has(String(account.twitterId))) {
      map.set(String(account.twitterId), account);
    }
  }
  return map;
}

function serializeCampaignRegistration(record, binanceSquareAccountMap = new Map()) {
  if (!record) return null;
  const json = typeof record.toJSON === "function" ? record.toJSON() : record;
  const {
    xHuntUserId: _omit,
    invitedByCode: _invitedByCode,
    invitedByUserId: _invitedByUserId,
    invitedByTwitterId: _invitedByTwitterId,
    invitedByUserInfo: _invitedByUserInfo,
    invitedByUsername: _invitedByUsername,
    registrationMetadata: _registrationMetadata,
    ...safe
  } = json;

  if (safe.xHuntUser) {
    const { inviteCode: _inviteCode, ...xHuntUser } = safe.xHuntUser;
    safe.xHuntUser = xHuntUser;
  }

  const twitterId = safe.twitterId ? String(safe.twitterId) : "";
  safe.binanceSquareAccount = binanceSquareAccountMap.get(twitterId) || null;
  return safe;
}

// 管理后台：活动报名名单查询
router.get(
  "/internal/registrations",
  adminAuth,
  requirePermission("nacos_config"),
  async (req, res) => {
    try {
      const normalizedCampaign = normalizeCampaign(req.query.campaign);
      if (!normalizedCampaign) {
        return res.status(400).json({ success: false, error: "campaign 为必填字段" });
      }

      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const pageSize = Math.min(
        Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
        200
      );
      const { twitterId, username, startDate, endDate } = req.query || {};

      const where = { campaign: normalizedCampaign };
      if (twitterId) where.twitterId = String(twitterId).trim();
      if (username) where.username = { [Op.iLike]: `%${String(username).trim()}%` };

      const startDt = parseUtcDateParam(startDate);
      const endDt = parseUtcDateParam(endDate);
      if (startDt || endDt) {
        const range = {};
        if (startDt) range[Op.gte] = startDt;
        if (endDt) range[Op.lte] = endDt;
        where.registeredAt = range;
      }

      const offset = (page - 1) * pageSize;
      const total = await CampaignRegistration.count({ where });
      const rows = total
        ? await CampaignRegistration.findAll({
            where,
            limit: pageSize,
            offset,
            order: [["registeredAt", "DESC"]],
            attributes: { exclude: ["xHuntUserId"] },
            include: [
              {
                model: XHuntUser,
                as: "xHuntUser",
                attributes: ["displayName", "classification"],
              },
            ],
          })
        : [];

      const binanceSquareAccountMap = await loadBinanceSquareAccountMap(rows);

      return res.json({
        success: true,
        data: {
          total,
          page,
          pageSize,
          rows: rows.map((row) => serializeCampaignRegistration(row, binanceSquareAccountMap)),
        },
      });
    } catch (err) {
      console.error("Admin campaign registrations query error:", err);
      return res.status(500).json({ success: false, error: "服务器内部错误（admin campaign registrations）" });
    }
  }
);

function normalizeRankCheckUsers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => ({
      id: item?.id == null ? null : String(item.id),
      username: item?.username == null ? null : String(item.username),
      twitterId: String(item?.twitterId || "").trim(),
    }))
    .filter((item) => {
      if (!item.twitterId || item.twitterId === "null" || item.twitterId === "undefined") return false;
      if (seen.has(item.twitterId)) return false;
      seen.add(item.twitterId);
      return true;
    })
    .slice(0, 200);
}

function normalizeAdminRankRow(domain, row, error) {
  if (error) {
    return {
      domain,
      status: "failed",
      kolRank: null,
      rankFollowers: null,
      userId: null,
      username: null,
      isCreator: false,
      creatorAuth: null,
      error,
    };
  }
  if (!row) {
    return {
      domain,
      status: "missing",
      kolRank: null,
      rankFollowers: null,
      userId: null,
      username: null,
      isCreator: false,
      creatorAuth: null,
      error: "未返回排名数据",
    };
  }

  const kolRank = Number(row.kolRank);
  const rankFollowers = Number(row.rank_followers);
  const creatorAuth = normalizeCreatorAuthPayload(row);
  return {
    domain,
    status: "success",
    kolRank: Number.isFinite(kolRank) ? kolRank : null,
    rankFollowers: Number.isFinite(rankFollowers) ? rankFollowers : null,
    userId: row.user_id == null ? null : String(row.user_id),
    username: row.username || null,
    isCreator: creatorAuth.isCreatorAuthed,
    creatorAuth,
    error: null,
  };
}

async function fetchAdminRankMap(domain, twitterIds) {
  const apiBase = RANK_API_BY_DOMAIN[domain];
  if (!apiBase) throw new Error(`Unsupported rank domain: ${domain}`);
  const response = await axios.get(apiBase, {
    params: { user_ids: twitterIds.join(",") },
    timeout: 10000,
  });
  const list = response?.data?.data?.data;
  if (!Array.isArray(list)) throw new Error(`Invalid ${domain} rank response`);
  const map = new Map();
  for (const row of list) {
    const userId = String(row?.user_id || row?.auth_creator?.twitter_id || row?.twitter_id || "").trim();
    if (userId) map.set(userId, row);
  }
  return map;
}

function buildAdminRankEligibility({ ranks, campaignConfig }) {
  const hasThreshold = !!campaignConfig && Number.isInteger(campaignConfig.threshold);
  if (!hasThreshold) {
    return {
      status: "no_threshold",
      eligible: true,
      label: "无需门槛",
      reason: "当前活动未配置报名门槛",
      activeDomains: [],
      threshold: null,
      includeCreator: !!campaignConfig?.includeCreator,
    };
  }

  const threshold = campaignConfig.threshold;
  const includeCreator = campaignConfig.includeCreator === true;
  const activeDomains = getCampaignDisplayDomains(campaignConfig).filter((domain) => RANK_API_BY_DOMAIN[domain]);
  const effectiveDomains = activeDomains.length ? activeDomains : ["web3"];
  const activeRanks = ranks.filter((item) => effectiveDomains.includes(item.domain));
  const meets = activeRanks.some((item) =>
    item.status === "success" &&
    rankResultMeetsThreshold(
      {
        domain: item.domain,
        kolRank: item.kolRank,
        isCreator: item.isCreator,
        isCreatorAuthed: item.isCreator,
        creatorAuth: item.creatorAuth,
      },
      threshold,
      includeCreator
    )
  );

  if (meets) {
    return {
      status: "eligible",
      eligible: true,
      label: "符合",
      reason: `满足报名门槛（threshold <= ${threshold}${includeCreator ? " 或 Creator 已认证" : ""}）`,
      activeDomains: effectiveDomains,
      threshold,
      includeCreator,
    };
  }

  const hasUnavailable = activeRanks.some((item) => item.status !== "success");
  if (hasUnavailable) {
    return {
      status: "unavailable",
      eligible: false,
      label: "无法判断",
      reason: "报名门槛所需排名数据未完整返回",
      activeDomains: effectiveDomains,
      threshold,
      includeCreator,
    };
  }

  return {
    status: "not_eligible",
    eligible: false,
    label: "不符合",
    reason: `未满足报名门槛（threshold <= ${threshold}${includeCreator ? " 或 Creator 已认证" : ""}）`,
    activeDomains: effectiveDomains,
    threshold,
    includeCreator,
  };
}

// 管理后台：批量查询报名用户 Web3 / AI 排名，并按当前活动报名门槛判断是否符合
router.post(
  "/internal/registrations/rank-check",
  adminAuth,
  requirePermission("nacos_config"),
  async (req, res) => {
    try {
      const normalizedCampaign = normalizeCampaign(req.body?.campaign);
      if (!normalizedCampaign) {
        return res.status(400).json({ success: false, error: "campaign 为必填字段" });
      }

      const users = normalizeRankCheckUsers(req.body?.users);
      if (!users.length) {
        return res.status(400).json({ success: false, error: "users 不能为空，且需要包含 twitterId" });
      }

      let campaignConfig =
        req.body?.campaignConfig && typeof req.body.campaignConfig === "object"
          ? req.body.campaignConfig
          : null;
      if (!campaignConfig) {
        campaignConfig = await getManagedCampaignPayloadByKey(normalizedCampaign, {
          includeTesting: true,
          channel: "admin",
        }).catch(() => null);
      }

      const twitterIds = users.map((item) => item.twitterId);
      const domains = ["web3", "ai"];
      const rankFetches = await Promise.allSettled(
        domains.map(async (domain) => ({ domain, map: await fetchAdminRankMap(domain, twitterIds) }))
      );

      const domainMaps = new Map();
      const domainErrors = new Map();
      rankFetches.forEach((result, index) => {
        const domain = domains[index];
        if (result.status === "fulfilled") {
          domainMaps.set(domain, result.value.map);
        } else {
          domainErrors.set(domain, result.reason?.message || String(result.reason));
        }
      });

      const rows = users.map((user) => {
        const ranks = domains.map((domain) => {
          const error = domainErrors.get(domain);
          const row = domainMaps.get(domain)?.get(user.twitterId) || null;
          return normalizeAdminRankRow(domain, row, error);
        });
        return {
          id: user.id,
          username: user.username,
          twitterId: user.twitterId,
          ranks,
          eligibility: buildAdminRankEligibility({ ranks, campaignConfig }),
        };
      });

      return res.json({
        success: true,
        data: {
          campaign: normalizedCampaign,
          checkedAt: new Date().toISOString(),
          campaignRule: {
            threshold: Number.isInteger(campaignConfig?.threshold) ? campaignConfig.threshold : null,
            includeCreator: campaignConfig?.includeCreator === true,
            displayDomains: campaignConfig ? getCampaignDisplayDomains(campaignConfig) : ["web3"],
          },
          total: rows.length,
          rows,
        },
      });
    } catch (err) {
      console.error("Admin campaign registration rank check error:", err);
      return res.status(500).json({ success: false, error: err.message || "服务器内部错误（rank check）" });
    }
  }
);

// 管理后台：超级管理员删除活动报名记录
router.delete(
  "/internal/registrations/:id",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ success: false, error: "id 为必填字段" });

      const where = { id };
      const normalizedCampaign = normalizeCampaign(req.query.campaign);
      if (normalizedCampaign) where.campaign = normalizedCampaign;

      const record = await CampaignRegistration.findOne({ where });
      if (!record) {
        return res.status(404).json({ success: false, error: "报名记录不存在或已删除" });
      }

      const safeRecord = serializeCampaignRegistration(record);
      await record.destroy();
      return res.json({ success: true, data: safeRecord });
    } catch (err) {
      console.error("Admin campaign registration delete error:", err);
      return res.status(500).json({ success: false, error: "服务器内部错误（delete campaign registration）" });
    }
  }
);

function getPluginRegistrationErrorMessage(error, fallback = "服务器内部错误（campaign register）") {
  const zhMessages = {
    PROFILE_DATA_INCOMPLETE: "外部数据校验失败：返回数据不完整",
    PROFILE_CREATED_AT_INVALID: "外部数据校验失败：创建时间无效",
    ACCOUNT_TOO_NEW: "不满足条件：账号注册需早于1个月",
    FOLLOWERS_TOO_LOW: "不满足条件：粉丝数量需不少于50",
    PROFILE_CHECK_FAILED: "外部数据校验请求失败",
    ALREADY_REGISTERED: "您已报名，无需重复提交",
  };
  return zhMessages[error?.message] || error?.publicMessage || error?.message || fallback;
}

// 1) 插件通用活动报名接口：
// 1. 使用插件 token、浏览器环境校验和签名安全中间件确认请求来源；
// 2. 插件入口仍单独校验插件版本，其余活动状态、报名窗口、EVM/Email、排名门槛、账号质量等规则交给公共报名 service；
// 3. 公共 service 写入 CampaignRegistration，来源标记为 extension，与 EchoHunt Web 报名共用同一张表；
// 4. 邀请码逻辑已下线：不再生成/返回 inviteCode，也不再处理邀请人统计。
router.post(
  "/register",
  fingerprintLimiter,
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    let LOG = "[CampaignRegister]";
    try {
      const authedUserId = req.user && req.user.id;
      const { campaign, evmAddress, email, emil, registrationUrl } = req.body || {};
      const rawEmail = email !== undefined ? email : emil;

      LOG = `[CampaignRegister] user_id=${authedUserId} campaign=${campaign} evmAddress=${evmAddress} email=${rawEmail ? "<provided>" : ""}`;

      const extVersion = req.headers["x-extension-version"] || req.headers["x-xhunt-extension-version"] || req.body?.extension_version;

      // 强制升级插件返回结构模板：后续需要启用时，取消下面注释即可。
      // 注意：该结构会被前端识别为“必须更新插件后才能继续报名”。
      // if (!isVersionGreaterOrEqual(extVersion, MIN_EXTENSION_VERSION)) {
      //   console.log(LOG, "reject: extension update required", {
      //     version: extVersion,
      //     minVersion: MIN_EXTENSION_VERSION,
      //   });
      //   return res.status(200).json(
      //     buildExtensionUpdateRequiredResponse({
      //       minVersion: MIN_EXTENSION_VERSION,
      //       message: {
      //         zh: "当前插件版本过低，请更新 XHunt 插件后再报名。",
      //         en: "Your XHunt extension is out of date. Please update it before signing up.",
      //       },
      //     }),
      //   );
      // }

      if (!isVersionGreaterOrEqual(extVersion, MIN_EXTENSION_VERSION)) {
        console.log(LOG, "reject: extension version too low", { version: extVersion });
        const isZh = (req.query.x_language || "").toLowerCase() === "zh";
        return res.status(400).json({
          error: isZh
            ? "请升级插件到 0.3.0 及以上版本再试"
            : "Please upgrade the extension to version 0.3.0 or above and try again",
        });
      }

      const normalizedCampaign = normalizeCampaignIdentifier(campaign);
      if (!normalizedCampaign) {
        console.log(LOG, "reject: campaign missing or invalid");
        return res.status(400).json({ error: "campaign is required" });
      }

      if (!authedUserId) {
        console.log(LOG, "reject: no auth");
        return res.status(401).json({ error: "未登录或 token 无效" });
      }
      const user = await XHuntUser.findByPk(authedUserId);
      if (!user) {
        console.log(LOG, "reject: user not found", { userId: authedUserId });
        return res.status(404).json({ error: "对应的用户不存在" });
      }

      console.log(LOG, "start", { campaign: normalizedCampaign });
      const found = await loadCampaignConfigForRegistration(normalizedCampaign, req, {
        channel: "plugin",
        viewer: { username: req.user?.username || user.username, twitterId: user.twitterId },
        allowComingSoonWarmup: false,
      });

      const fallbackUrl = req.headers["x-window-location-href"]
        ? String(req.headers["x-window-location-href"])
        : null;
      const pageUrl = typeof registrationUrl === "string" ? registrationUrl : fallbackUrl;
      const contact = normalizeRegistrationContact({ evmAddress, email: rawEmail });

      const result = await registerCampaignParticipant({
        req,
        campaign: normalizedCampaign,
        campaignConfig: found,
        user: {
          xHuntUserId: user.id,
          twitterId: user.twitterId,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
        },
        userRecord: user,
        contact,
        registrationUrl: pageUrl,
        registrationSource: "extension",
        registrationClient: "xhunt_extension",
        registrationMetadata: {
          extensionVersion: extVersion || null,
          userAgent: req.headers["user-agent"] || null,
          pageUrl,
          source: "extension",
        },
        cooldownKey: `campaign:${normalizedCampaign}:register:cd:${user.id}`,
      });

      const { xHuntUserId: _omit, registrationMetadata: _registrationMetadata, ...safeRecord } = result.registration.toJSON();
      console.log(LOG, "success", { userId: user.id, campaign: normalizedCampaign });
      return res.json({
        success: true,
        registration: safeRecord,
      });
    } catch (err) {
      const status = err.status || 500;
      const message = getPluginRegistrationErrorMessage(err);
      console.error(LOG, "error:", err.message || err, err.details || "");
      return res.status(status).json({ error: message });
    }
  }
);

// 2) 活动报名列表查询
router.get("/registrations", async (req, res) => {
  try {
    const normalizedCampaign = normalizeCampaign(req.query.campaign);
    if (!normalizedCampaign) {
      return res.status(400).json({ error: "campaign 为必填字段" });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
      200
    );
    const { twitterId, startDate, endDate } = req.query || {};

    const where = { campaign: normalizedCampaign };
    if (twitterId) {
      where.twitterId = String(twitterId);
    }

    const startDt = parseUtcDateParam(startDate);
    const endDt = parseUtcDateParam(endDate);
    if (startDt || endDt) {
      const range = {};
      if (startDt) range[Op.gte] = startDt;
      if (endDt) range[Op.lte] = endDt;
      if (Object.keys(range).length > 0) {
        where.registeredAt = range;
      }
    }

    const offset = (page - 1) * pageSize;

    // 优化：拆分 count 和 find，避免 COUNT 时 JOIN 产生子查询
    const total = await CampaignRegistration.count({ where });

    // 如果总数为 0，直接返回空结果
    if (total === 0) {
      return res.json({
        total: 0,
        page,
        pageSize,
        rows: [],
      });
    }

    const rows = await CampaignRegistration.findAll({
      where,
      limit: pageSize,
      offset,
      // 优化：使用 registeredAt 排序（已有索引），代替 createdAt
      order: [["registeredAt", "DESC"]],
      attributes: { exclude: ["xHuntUserId"] },
      include: [
        {
          model: XHuntUser,
          as: "xHuntUser",
          attributes: ["displayName", "classification"],
        },
      ],
    });

    const binanceSquareAccountMap = await loadBinanceSquareAccountMap(rows);

    return res.json({
      total,
      page,
      pageSize,
      rows: rows.map((row) => serializeCampaignRegistration(row, binanceSquareAccountMap)),
    });
  } catch (err) {
    console.error("Campaign registrations query error:", err);
    return res
      .status(500)
      .json({ error: "服务器内部错误（campaign registrations）" });
  }
});

// 3) 查询当前用户在某活动下的报名信息
router.get(
  "/me",
  authenticateTokenOptional,
  browserOnlyMiddleware,
  securityMiddleware,
  async (req, res) => {
    try {
      const normalizedCampaign = normalizeCampaign(req.query.campaign);
      if (!normalizedCampaign) {
        return res.status(400).json({ error: "campaign 为必填字段" });
      }

      let totalRegistrations = 0;
      try {
        totalRegistrations = await CampaignRegistration.count({
          where: { campaign: normalizedCampaign },
        });
      } catch (countErr) {
        console.error("Campaign total registrations count error:", countErr);
      }

      const userId = req.user && req.user.id;
      if (!userId) {
        return res
          .status(200)
          .json({ registered: false, totalRegistrations, invitedCount: 0 });
      }

      const record = await CampaignRegistration.findOne({
        where: { campaign: normalizedCampaign, xHuntUserId: userId },
        order: [["createdAt", "DESC"]],
        attributes: { exclude: ["xHuntUserId"] },
        include: [
          {
            model: XHuntUser,
            as: "xHuntUser",
            attributes: ["inviteCode", "displayName"],
          },
        ],
      });

      if (!record) {
        return res.status(200).json({
          registered: false,
          invitedCount: 0,
          totalRegistrations,
        });
      }

      let hunterData = null;
      if (req.user && req.user.username) {
        try {
          const response = await axios.post(
            "https://data.cryptohunt.ai/pro/api/hunter_by_handle",
            {
              campaign: normalizedCampaign,
              handle: req.user.username,
            },
            {
              timeout: 10000,
            }
          );

          hunterData = response.data;
        } catch (hunterErr) {
          console.error("Campaign hunter data fetch error:", hunterErr);

          if (hunterErr.code === "ECONNABORTED") {
            return res.status(408).json({
              error: "获取 hunter 数据超时，请稍后重试",
              hunterDataError: "timeout",
            });
          }
          if (hunterErr.response) {
            return res.status(hunterErr.response.status).json({
              error: `获取 hunter 数据失败: ${hunterErr.response.status}`,
              hunterDataError: "api_error",
            });
          }
          if (hunterErr.request) {
            return res.status(503).json({
              error: "无法连接到 hunter 数据服务，请稍后重试",
              hunterDataError: "connection_error",
            });
          }
          return res.status(500).json({
            error: "获取 hunter 数据时发生未知错误",
            hunterDataError: "unknown_error",
          });
        }
      }

      res.set("Cache-Control", "private, max-age=80");
      return res.status(200).json({
        registered: true,
        invitedCount: 0,
        totalRegistrations,
        registration: record,
        hunterData,
      });
    } catch (err) {
      console.error("Campaign me query error:", err);
      return res.status(500).json({ error: "服务器内部错误（campaign me）" });
    }
  }
);

// ============================================
// 自定义支持任务（Custom Task）接口
// ============================================

/**
 * 根据 campaign 生成第三方跳转链接
 * TODO: 根据 campaign 实现具体的第三方 API 调用
 */
async function generateExternalLink(campaign, taskId, user) {
  // realgo 活动实现
  if (campaign === 'realgo') {
    const timestamp = Math.floor(Date.now() / 1000); // Unix 时间戳（秒）
    const rawToken = `${user.twitterId}:${timestamp}`;
    const secretKey = 'JvApDef2C2Vkg9VRAM+jcjPXaCYFw6xyZnmIiaUxVUs=';
    console.log('[generateExternalLink]', rawToken, `rawToken ${taskId} ${user.id}`)
    
    // Token Base64 编码
    const xHuntToken = Buffer.from(rawToken).toString('base64');
    
    // 生成 HMACSHA256 签名（基于 Base64 编码后的 token）
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(xHuntToken)
      .digest('hex');

    // console.log('[generateExternalLink]', signature, `rawToken ${taskId} ${user.id}`)
    
    // 构建跳转链接
    const link = `https://app.realgo.game/reg?code=XHUNT&xHuntToken=${encodeURIComponent(xHuntToken)}&xHuntSignature=${encodeURIComponent(signature)}`;
    
    console.log('[generateExternalLink]', link, `rawToken ${taskId} ${user.id}`)
    return {
      link,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5分钟有效期
    };
  }
  
  throw new Error(`Campaign ${campaign} custom task provider not implemented`);
}

/**
 * 根据 campaign 查询第三方任务完成状态
 * TODO: 根据 campaign 实现具体的第三方 API 调用
 */
async function queryExternalStatus(campaign, taskId, user) {
  // realgo 活动 - 调用 XHuntStats 接口查询用户是否注册
  if (campaign === 'realgo') {
    try {
      const response = await axios.get(
        'https://api.myreal.io/api/v1/PartnerService/XHuntStats',
        { timeout: 10000 }
      );
      
      const statsList = response.data;
      if (!Array.isArray(statsList)) {
        throw new Error('Invalid response format from realgo API');
      }
      
      // 查找用户的 twitterId 是否在列表中
      const userStat = statsList.find(
        (item) => String(item.twitterId).toLocaleLowerCase() === String(user.twitterId).toLocaleLowerCase()
      );
      
      if (userStat) {
        return {
          completed: true,
          completedAt: null, // realgo API 不返回完成时间
          metadata: {
            userId: userStat.userId,
            isKol: userStat.isKol,
            hasPurchasedHarvester: userStat.hasPurchasedHarvester,
            loyaltyPoints: userStat.loyaltyPoints,
          },
        };
      }
      
      // 用户不在列表中，返回未完成
      return {
        completed: false,
        completedAt: null,
        metadata: {},
      };
    } catch (err) {
      console.error('[RealgoStatus] API error:', err.message);
      throw new Error('Failed to query realgo status');
    }
  }
  
  throw new Error(`Campaign ${campaign} custom task provider not implemented`);
}

// 1) 获取自定义任务的第三方跳转链接
router.post(
  "/custom-task/link",
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const { campaign, taskId } = req.body || {};
      
      const LOG = `[CustomTaskLink] user_id=${userId} campaign=${campaign} taskId=${taskId}`;
      
      // 参数校验
      if (!campaign || typeof campaign !== "string") {
        return res.status(400).json({ error: "campaign is required" });
      }
      if (!taskId || typeof taskId !== "string") {
        return res.status(400).json({ error: "taskId is required" });
      }
      
      // 获取用户信息
      const user = await XHuntUser.findByPk(userId);
      if (!user) {
        console.log(LOG, "reject: user not found");
        return res.status(404).json({ error: "User not found" });
      }
    
      // 调用第三方接口生成链接
      try {
        const result = await generateExternalLink(campaign, taskId, user);
        console.log(LOG, "success");
        return res.json({
          success: true,
          link: result.link,
          expiresAt: result.expiresAt,
        });
      } catch (externalErr) {
        console.error(LOG, "external provider error:", externalErr.message);
        return res.status(503).json({
          error: "External service unavailable",
          message: externalErr.message,
        });
      }
    } catch (err) {
      console.error("[CustomTaskLink] error:", err.message || err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// 2) 查询自定义任务的完成状态
router.get(
  "/custom-task/status",
  browserOnlyMiddleware,
  authenticateTokenOptional,
  securityMiddleware,
  async (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const campaign = req.query.campaign;
      const taskId = req.query.taskId;
      
      const LOG = `[CustomTaskStatus] user_id=${userId} campaign=${campaign} taskId=${taskId}`;
      
      // 参数校验
      if (!campaign || typeof campaign !== "string") {
        return res.status(400).json({ error: "campaign is required" });
      }
      if (!taskId || typeof taskId !== "string") {
        return res.status(400).json({ error: "taskId is required" });
      }
      
      // 未登录用户返回未登录状态
      if (!userId) {
        return res.status(200).json({
          success: true,
          completed: false,
        });
      }
      
      // 获取用户信息
      const user = await XHuntUser.findByPk(userId);
      if (!user) {
        console.log(LOG, "reject: user not found");
        return res.status(404).json({ error: "User not found" });
      }
      
      // 调用第三方接口查询状态
      try {
        const result = await queryExternalStatus(campaign, taskId, user);
        console.log(LOG, "success, completed:", result.completed);
        return res.json({
          success: true,
          completed: result.completed,
          completedAt: result.completedAt || null,
          metadata: result.metadata || {},
        });
      } catch (externalErr) {
        console.error(LOG, "external provider error:", externalErr.message);
        return res.status(503).json({
          error: "External service unavailable",
          message: externalErr.message,
        });
      }
    } catch (err) {
      console.error("[CustomTaskStatus] error:", err.message || err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
