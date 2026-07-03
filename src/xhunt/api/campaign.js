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
} = require("../../models/postgres-start");
const { isRequestXHuntVip, isRequestInternalTestUser } = require("../constants/xhuntVip");
const {
  getManagedCampaignPayloadByKey,
  listPluginCampaigns,
} = require("../services/websiteCampaignService");
const {
  getCachedPluginCampaigns,
} = require("../utils/campaign-config-cache");
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

function generateInviteCode(length = 10) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return code;
}

async function ensureUniqueInviteCode() {
  for (let i = 0; i < 5; i += 1) {
    const code = generateInviteCode(10);
    const existed = await XHuntUser.findOne({ where: { inviteCode: code } });
    if (!existed) return code;
  }
  throw new Error("Failed to generate unique invite code");
}

// const SPECIAL_INVITE_CODE = "XHuntAI";

function normalizeCampaign(raw) {
  if (!raw || typeof raw !== "string") return null;
  return raw.trim();
}

function normalizeEmail(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw).trim().toLowerCase();
}

function isValidEmail(value) {
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeTesterHandle(value) {
  if (Array.isArray(value)) return normalizeTesterHandle(value[0]);
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function isCampaignTester(campaign, requestHandle) {
  if (!campaign || !requestHandle) return false;
  const list = Array.isArray(campaign.testList) ? campaign.testList : [];
  return list.some((item) => normalizeTesterHandle(item) === requestHandle);
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

const INITIALIZE_CAMPAIGN_URL =
  "https://data.cryptohunt.ai/pro/api/initialize_campaign";
const INITIALIZE_CAMPAIGN_CACHE_TTL = 86400; // 1 天
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

const RANK_API_BY_DOMAIN = {
  web3: "https://data.cryptohunt.ai/fetch/twitter/rank",
  ai: "https://data.cryptohunt.ai/fetch/ai/rank",
};

function isRankValid(rank) {
  return Number.isFinite(rank);
}

function isCreatorRankData(rankData) {
  return rankData?.auth_creator?.status === 2;
}

async function fetchCampaignRankByDomain(domain, twitterId) {
  const apiBase = RANK_API_BY_DOMAIN[domain];
  if (!apiBase) {
    throw new Error(`Unsupported rank domain: ${domain}`);
  }

  const rankApiUrl = `${apiBase}?user_ids=${encodeURIComponent(twitterId)}`;
  const rankResponse = await axios.get(rankApiUrl, { timeout: 7000 });
  const list = rankResponse?.data?.data?.data;

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`Empty ${domain} ranking data`);
  }

  const userRankData = list[0];
  return {
    domain,
    kolRank: Number(userRankData.kolRank),
    isCreator: isCreatorRankData(userRankData),
  };
}

function rankResultMeetsThreshold(result, threshold, includeCreator) {
  if (isRankValid(result.kolRank) && result.kolRank <= threshold) {
    return true;
  }
  return !!includeCreator && result.isCreator;
}

function formatRankForMessage(result) {
  if (!result) return "unknown";
  return isRankValid(result.kolRank) ? result.kolRank : "unranked";
}

async function getCustomCampaignConfig(campaign, req) {
  const found = await getManagedCampaignPayloadByKey(campaign, {
    includeTesting: true,
    channel: "plugin",
  });
  if (!found || !found.enabled) return null;
  if (found.testingPhase) {
    const requestHandle = normalizeTesterHandle(req?.headers?.["x-user-id"]);
    const allowed =
      isRequestInternalTestUser(req) || isCampaignTester(found, requestHandle);
    if (!allowed) return null;
  }
  return found;
}

router.get("/config", securityMiddleware, authenticateTokenOptional, async (req, res) => {
  try {
    const requestHandle = normalizeTesterHandle(req.headers["x-user-id"]);
    const requestedDomain = normalizeDisplayDomain(
      req.query.domain || req.query.displayDomain,
    );
    if (requestedDomain === null) {
      return res.status(400).json({
        success: false,
        error: "Invalid domain. Supported values: web3, ai",
      });
    }

    if (!requestHandle) {
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
      const allowed = isCampaignTester(campaign, requestHandle);
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

    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      campaign: normalizedCampaign,
      updatedAt: new Date().toISOString(),
      leaderboards: {},
    });
  } catch (err) {
    console.error("[CustomLeaderboard] error:", err.message || err);
    return res.status(502).json({
      success: false,
      error: "Failed to fetch custom leaderboard",
    });
  }
});

router.get("/custom-user-activity", securityMiddleware, async (req, res) => {
  try {
    const normalizedCampaign = normalizeCampaign(req.query.campaign);
    const userId = req.query.userid || req.query.userId;
    if (!normalizedCampaign) {
      return res.status(400).json({ success: false, error: "campaign is required" });
    }
    if (!userId) {
      return res.status(400).json({ success: false, error: "userid is required" });
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

    res.set("Cache-Control", "private, max-age=300");
    return res.json({
      success: true,
      campaign: normalizedCampaign,
      userid: String(userId),
      leaderboards: {},
    });
  } catch (err) {
    console.error("[CustomUserActivity] error:", err.message || err);
    return res.status(502).json({
      success: false,
      error: "Failed to fetch custom user activity",
    });
  }
});

/**
 * 报名成功后通知 data.cryptohunt.ai 初始化 campaign；Redis 缓存 1 天内不重复调用。
 * 不阻塞主流程，仅 fire-and-forget。
 */
async function notifyInitializeCampaign(redisClient, campaign) {
  if (!campaign || !redisClient) return;
  const cacheKey = `campaign:initialize_campaign:${campaign}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return;
  } catch (_) {}
  try {
    const resp = await axios.post(
      INITIALIZE_CAMPAIGN_URL,
      { campaign },
      { timeout: 10000 }
    );
    const ok = resp.data && resp.data.status === true;
    if (ok) {
      try {
        await redisClient.setEx(cacheKey, INITIALIZE_CAMPAIGN_CACHE_TTL, "1");
      } catch (_) {}
    }
  } catch (e) {
    throw e;
  }
}


function serializeCampaignRegistration(record) {
  if (!record) return null;
  const json = typeof record.toJSON === "function" ? record.toJSON() : record;
  const { xHuntUserId: _omit, ...safe } = json;
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
                attributes: ["inviteCode", "displayName", "classification"],
              },
            ],
          })
        : [];

      return res.json({
        success: true,
        data: {
          total,
          page,
          pageSize,
          rows: rows.map(serializeCampaignRegistration),
        },
      });
    } catch (err) {
      console.error("Admin campaign registrations query error:", err);
      return res.status(500).json({ success: false, error: "服务器内部错误（admin campaign registrations）" });
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

// 1) 通用活动报名
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
      const { campaign, evmAddress, email, emil, registrationUrl } =
        req.body || {};
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

      const normalizedCampaign = normalizeCampaign(campaign);
      if (!normalizedCampaign) {
        console.log(LOG, "reject: campaign missing or invalid");
        return res.status(400).json({ error: "campaign is required" });
      }
      console.log(LOG, "start", { campaign: normalizedCampaign });

      let found = null;
      try {
        const isInternalTester = isRequestInternalTestUser(req);
        found = await getManagedCampaignPayloadByKey(normalizedCampaign, {
          includeTesting: true,
        });
        if (!found) {
          console.log(LOG, "reject: campaign not found in database", { campaign: normalizedCampaign });
          return res.status(400).json({ error: "Invalid campaign identifier" });
        }
        if (found.testingPhase) {
          const requestHandle = normalizeTesterHandle(
            req.headers["x-user-id"] || req.user?.username,
          );
          const allowedTester =
            isInternalTester || isCampaignTester(found, requestHandle);
          if (!allowedTester) {
            console.log(LOG, "reject: campaign in testing phase", {
              campaign: normalizedCampaign,
              requestHandle,
            });
            return res.status(403).json({ error: "Campaign is in testing phase" });
          }
        }
        if (!found.enabled) {
          console.log(LOG, "reject: campaign not enabled", { campaign: normalizedCampaign });
          return res.status(400).json({ error: "Campaign is not enabled" });
        }
        const now = new Date();
        const startAt = found.enrollmentWindow && found.enrollmentWindow.startAt ? new Date(found.enrollmentWindow.startAt) : null;
        const endAt = found.enrollmentWindow && found.enrollmentWindow.endAt ? new Date(found.enrollmentWindow.endAt) : null;
        if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
          console.log(LOG, "reject: invalid enrollment window");
          return res.status(502).json({ error: "Invalid enrollment window in config" });
        }
        // 允许在正式开始时间前 1 小时即可报名
        const oneHourMs = 60 * 60 * 1000;
        const startAtWithGrace = new Date(startAt.getTime() - oneHourMs);
        if (now < startAtWithGrace || now > endAt) {
          console.log(LOG, "reject: outside enrollment window");
          return res.status(400).json({ error: "Not within the enrollment window" });
        }
      } catch (cfgErr) {
        console.error(LOG, "fetch campaigns config error:", cfgErr.message || cfgErr);
        return res.status(502).json({ error: "Campaign configuration service unavailable" });
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

      const allowEmailRegistration = found && found.allowEmailRegistration === true;
      const trimmedAddress =
        typeof evmAddress === "string" && evmAddress.trim()
          ? evmAddress.trim()
          : null;
      const normalizedEmail = normalizeEmail(rawEmail);
      const hasEmail = !!normalizedEmail;
      const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;

      if (trimmedAddress && !evmAddressRegex.test(trimmedAddress)) {
        console.log(LOG, "reject: invalid evm format", { len: trimmedAddress.length });
        return res.status(400).json({ error: "Invalid EVM address format" });
      }

      if (!allowEmailRegistration) {
        if (hasEmail) {
          console.log(LOG, "reject: email registration not allowed");
          return res.status(400).json({ error: "Email registration is not allowed for this campaign" });
        }
        if (!trimmedAddress) {
          console.log(LOG, "reject: evm address missing");
          return res.status(400).json({ error: "EVM address is required" });
        }
      } else {
        if (!trimmedAddress && !hasEmail) {
          console.log(LOG, "reject: registration contact missing");
          return res.status(400).json({ error: "EVM address or email is required" });
        }
        if (trimmedAddress && hasEmail) {
          console.log(LOG, "reject: both evm and email provided");
          return res.status(400).json({ error: "Please provide either EVM address or email, not both" });
        }
        if (hasEmail && !isValidEmail(normalizedEmail)) {
          console.log(LOG, "reject: invalid email format");
          return res.status(400).json({ error: "Invalid email format" });
        }
      }

      if (req.redisClient) {
        try {
          const cooldownKey = `campaign:${normalizedCampaign}:register:cd:${user.id}`;
          const ttl = await req.redisClient.ttl(cooldownKey);
          if (typeof ttl === "number" && ttl > 0) {
            console.log(LOG, "reject: cooldown", { userId: user.id });
            return res.status(429).json({
              error: `Too frequent requests, please try again in ${ttl}s`,
            });
          }
          await req.redisClient.setEx(cooldownKey, 10, "1");
        } catch (cdErr) {
        }
      }

      // 检查报名门槛：threshold、includeCreator 和活动支持领域
      if (found && Number.isInteger(found.threshold)) {
        try {
          const twitterId = String(user.twitterId);
          if (!twitterId || twitterId === "null" || twitterId === "undefined") {
            console.log(LOG, "reject: invalid twitter id");
            return res.status(400).json({ error: "Invalid Twitter ID" });
          }

          const rankDomains = getCampaignDisplayDomains(found)
            .filter((domain) => RANK_API_BY_DOMAIN[domain]);
          const domainsToCheck = rankDomains.length ? rankDomains : ["web3"];

          const rankResults = await Promise.allSettled(
            domainsToCheck.map((domain) => fetchCampaignRankByDomain(domain, twitterId))
          );

          const fulfilledResults = rankResults
            .filter((result) => result.status === "fulfilled")
            .map((result) => result.value);
          const rejectedResults = rankResults.filter((result) => result.status === "rejected");

          const meetsThreshold = fulfilledResults.some((result) =>
            rankResultMeetsThreshold(result, found.threshold, found.includeCreator)
          );

          if (!meetsThreshold) {
            if (!fulfilledResults.length || rejectedResults.length > 0) {
              rejectedResults.forEach((result) => {
                console.error(LOG, "rank domain check error:", result.reason?.message || result.reason);
              });
              return res.status(502).json({ error: "Failed to fetch user ranking data" });
            }

            const rankSummary = fulfilledResults
              .map((result) => `${result.domain}: ${formatRankForMessage(result)}`)
              .join(", ");
            console.log(LOG, "reject: threshold not met", {
              userId: user.id,
              ranks: fulfilledResults,
              threshold: found.threshold,
              domains: domainsToCheck,
            });
            return res.status(400).json({
              error: `Does not meet registration threshold: KOL rank must be less than or equal to ${found.threshold}, current rank is ${rankSummary}`
            });
          }
        } catch (rankErr) {
          console.error(LOG, "threshold check error:", rankErr.message || rankErr);
          return res.status(502).json({ error: "Threshold check request failed, please try again later" });
        }
      }

      if (trimmedAddress) {
        const existingEVM = await CampaignRegistration.findOne({
          where: {
            campaign: normalizedCampaign,
            evmAddress: trimmedAddress,
          },
        });
        if (existingEVM) {
          console.log(LOG, "reject: evm already used", { campaign: normalizedCampaign });
          return res
            .status(409)
            .json({ error: "This EVM address is already in use" });
        }
      }

      if (hasEmail) {
        const existingEmail = await CampaignRegistration.findOne({
          where: {
            campaign: normalizedCampaign,
            email: normalizedEmail,
          },
        });
        if (existingEmail) {
          console.log(LOG, "reject: email already used", { campaign: normalizedCampaign });
          return res
            .status(409)
            .json({ error: "This email is already in use" });
        }
      }

      let inviter = null;
      const isSpecialUser = isRequestXHuntVip(req);

      // if (typeof invitedByCode === "string" && invitedByCode.trim()) {
      //   const code = invitedByCode.trim();
      //   if (code.toLowerCase() === SPECIAL_INVITE_CODE.toLowerCase()) {
      //     if (!isSpecialUser) {
      //       return res
      //         .status(403)
      //         .json({ error: "You are not a specially invited user" });
      //     }
      //   } else {
      //     inviter = await XHuntUser.findOne({
      //       where: { inviteCode: code },
      //     });
      //     if (!inviter) {
      //       return res.status(400).json({ error: "Invalid invite code" });
      //     }
      //     // 不能使用自己的邀请码
      //     if (inviter.id === user.id) {
      //       return res.status(400).json({ error: "Cannot use your own invite code" });
      //     }
      //   }
      // }

      if (!isSpecialUser) {
        try {
          const apiUrl =
            "https://data.cryptohunt.ai/pro/api/inner/profile_by_userid";
          const payload = { user_id: String(user.twitterId) };
          const response = await axios.post(apiUrl, payload, { timeout: 7000 });

          const data = response && response.data ? response.data : null;
          if (
            !data ||
            !data.created_at ||
            typeof data.followers_count !== "number"
          ) {
            console.log(LOG, "reject: profile data incomplete");
            return res
              .status(502)
              .json({ error: "外部数据校验失败：返回数据不完整" });
          }

          const createdAt = new Date(data.created_at);
          if (Number.isNaN(createdAt.getTime())) {
            console.log(LOG, "reject: profile created_at invalid");
            return res
              .status(502)
              .json({ error: "外部数据校验失败：创建时间无效" });
          }

          const now = new Date();
          const oneMonthAgo = new Date(now.getTime());
          oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

          if (createdAt > oneMonthAgo) {
            console.log(LOG, "reject: account too new");
            return res
              .status(400)
              .json({ error: "不满足条件：账号注册需早于1个月" });
          }

          if (data.followers_count < 50) {
            console.log(LOG, "reject: followers < 50");
            return res
              .status(400)
              .json({ error: "不满足条件：粉丝数量需不少于50" });
          }
        } catch (apiErr) {
          console.error(LOG, "profile check error:", apiErr.message || apiErr);
          return res.status(502).json({ error: "外部数据校验请求失败" });
        }
      }

      const existed = await CampaignRegistration.findOne({
        where: {
          campaign: normalizedCampaign,
          [Op.or]: [{ xHuntUserId: user.id }, { twitterId: user.twitterId }],
        },
      });
      if (existed) {
        console.log(LOG, "reject: already registered", { userId: user.id });
        return res.status(409).json({ error: "您已报名，无需重复提交" });
      }

      if (!user.inviteCode) {
        let uniqueCode;
        try {
          uniqueCode = await ensureUniqueInviteCode();
        } catch (e) {
          console.error(LOG, "invite code gen error:", e.message || e);
          return res.status(500).json({ error: "邀请码生成失败" });
        }
        user.inviteCode = uniqueCode;
        await user.save();
      }

      const fallbackUrl = req.headers["x-window-location-href"]
        ? String(req.headers["x-window-location-href"])
        : null;

      const record = await CampaignRegistration.create({
        campaign: normalizedCampaign,
        xHuntUserId: user.id,
        twitterId: user.twitterId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        // invitedByCode: typeof invitedByCode === "string" ? invitedByCode : null,
        invitedByCode: null,
        invitedByUserId: inviter ? inviter.id : null,
        invitedByTwitterId: inviter ? inviter.twitterId : null,
        invitedByUsername: inviter ? inviter.username : null,
        invitedByUserInfo: inviter
          ? {
            username: inviter.username,
            displayName: inviter.displayName,
            avatar: inviter.avatar,
            classification: inviter.classification,
            inviteCode: inviter.inviteCode,
            createdAt: inviter.createdAt,
          }
          : null,
        evmAddress: trimmedAddress,
        email: hasEmail ? normalizedEmail : null,
        registrationUrl:
          typeof registrationUrl === "string" ? registrationUrl : fallbackUrl,
        registrationSource: "extension",
        registrationClient: "xhunt_extension",
        registrationMetadata: {
          extensionVersion: extVersion || null,
          userAgent: req.headers["user-agent"] || null,
          pageUrl: typeof registrationUrl === "string" ? registrationUrl : fallbackUrl,
          source: "extension",
        },
      });

      if (inviter && inviter.id && req.redisClient) {
        const cacheKey = `campaign:${normalizedCampaign}:invites:count:${inviter.id}`;
        try {
          await req.redisClient.del(cacheKey);
        } catch (redisDelErr) {
          console.warn("Redis DEL campaign invite count warn:", redisDelErr);
        }
      }

      if (req.redisClient) {
        notifyInitializeCampaign(req.redisClient, normalizedCampaign).catch(
          (e) =>
            console.warn(
              LOG,
              "initialize_campaign notify warn:",
              e.message || e
            )
        );
      }

      const { xHuntUserId: _omit, ...safeRecord } = record.toJSON();
      console.log(LOG, "success", { userId: user.id, campaign: normalizedCampaign });
      return res.json({
        success: true,
        inviteCode: user.inviteCode || null,
        registration: safeRecord,
      });
    } catch (err) {
      console.error(LOG, "error:", err.message || err);
      return res.status(500).json({ error: "服务器内部错误（campaign register）" });
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
          attributes: ["inviteCode", "displayName", "classification"],
        },
      ],
    });

    return res.json({
      total,
      page,
      pageSize,
      rows,
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
