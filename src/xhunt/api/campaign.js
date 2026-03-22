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
const { XHUNT_VIP } = require("../constants/xhuntVip");
const { parseUtcDateParam } = require("../utils/date");
const { isVersionGreaterOrEqual } = require("../utils/version");

const router = express.Router();

const MIN_EXTENSION_VERSION = "0.2.16";

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

const SPECIAL_INVITE_CODE = "XHuntAI";
const SPECIAL_ALLOWED_USERNAMES = XHUNT_VIP;

function normalizeCampaign(raw) {
  if (!raw || typeof raw !== "string") return null;
  return raw.trim();
}

const INITIALIZE_CAMPAIGN_URL =
  "https://data.cryptohunt.ai/pro/api/initialize_campaign";
const INITIALIZE_CAMPAIGN_CACHE_TTL = 86400; // 1 天

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

// 1) 通用活动报名
router.post(
  "/register",
  fingerprintLimiter,
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    try {
      const authedUserId = req.user && req.user.id;
      const { campaign, evmAddress, registrationUrl } =
        req.body || {};

      const LOG = `[CampaignRegister] user_id=${authedUserId} campaign=${campaign} evmAddress=${evmAddress}`;

      const extVersion = req.headers["x-extension-version"];
      if (!isVersionGreaterOrEqual(extVersion, MIN_EXTENSION_VERSION)) {
        console.log(LOG, "reject: extension version too low", { version: extVersion });
        const isZh = (req.query.x_language || "").toLowerCase() === "zh";
        return res.status(400).json({
          error: isZh
            ? "请升级插件到 0.2.16 及以上版本再试"
            : "Please upgrade the extension to version 0.2.16 or above and try again",
        });
      }
      if (campaign === 'realgo' && !isVersionGreaterOrEqual(extVersion, "0.2.18")) {
        console.log(LOG, "reject: extension version too low", { version: extVersion });
        const isZh = (req.query.x_language || "").toLowerCase() === "zh";
        return res.status(400).json({
          error: isZh
            ? "请升级插件到 0.2.18 及以上版本再试"
            : "Please upgrade the extension to version 0.2.18 or above and try again",
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
        const cfgResp = await axios.get(
          "https://kb.xhunt.ai/nacos-configs?dataId=xhunt_campaigns&group=DEFAULT_GROUP",
          { timeout: 7000 }
        );
        const cfg = cfgResp && cfgResp.data ? cfgResp.data : null;
        if (!cfg || !Array.isArray(cfg.campaigns)) {
          console.log(LOG, "reject: nacos config incomplete");
          return res.status(502).json({ error: "Failed to fetch campaigns config: incomplete data" });
        }
        found = cfg.campaigns.find(
          (c) => c && c.campaignKey === normalizedCampaign
        );
        if (!found) {
          console.log(LOG, "reject: campaign not found", { campaign: normalizedCampaign });
          return res.status(400).json({ error: "Invalid campaign identifier" });
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

      if (!evmAddress || typeof evmAddress !== "string" || !evmAddress.trim()) {
        console.log(LOG, "reject: evm address missing");
        return res.status(400).json({ error: "EVM address is required" });
      }
      const trimmedAddress = evmAddress.trim();
      const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!evmAddressRegex.test(trimmedAddress)) {
        console.log(LOG, "reject: invalid evm format", { len: trimmedAddress.length });
        return res.status(400).json({ error: "Invalid EVM address format" });
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

      // 检查报名门槛：threshold 和 includeCreator
      if (found && Number.isInteger(found.threshold)) {
        try {
          const twitterId = String(user.twitterId);
          if (!twitterId || twitterId === "null" || twitterId === "undefined") {
            console.log(LOG, "reject: invalid twitter id");
            return res.status(400).json({ error: "Invalid Twitter ID" });
          }

          const rankApiUrl = `https://data.cryptohunt.ai/fetch/twitter/rank?user_ids=${twitterId}`;
          const rankResponse = await axios.get(rankApiUrl, { timeout: 7000 });

          const rankData = rankResponse?.data;
          const list = rankData?.data?.data;
          if (!Array.isArray(list) || list.length === 0) {
            return res.status(502).json({ error: "Failed to fetch user ranking data" });
          }

          const userRankData = list[0];
          const kolRank = Number(userRankData.kolRank);
          const authCreator = userRankData.auth_creator;

          // 检查 threshold 门槛
          if (found.threshold !== undefined && typeof found.threshold === "number") {
            const meetsThreshold = kolRank !== undefined && kolRank !== null && kolRank <= found.threshold;

            // 如果不满足门槛，检查是否支持创作者
            if (!meetsThreshold) {
              const isCreator = found.includeCreator &&
                authCreator &&
                authCreator.status === 2;

              if (!isCreator) {
                console.log(LOG, "reject: threshold not met", { userId: user.id, kolRank, threshold: found.threshold });
                return res.status(400).json({
                  error: `Does not meet registration threshold: KOL rank must be less than or equal to ${found.threshold}, current rank is ${kolRank}`
                });
              }
            }
          }
        } catch (rankErr) {
          console.error(LOG, "threshold check error:", rankErr.message || rankErr);
          return res.status(502).json({ error: "Threshold check request failed, please try again later" });
        }
      }

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

      let inviter = null;
      const userHandle = (user.username || "").toLowerCase();
      const isSpecialUser = SPECIAL_ALLOWED_USERNAMES.has(userHandle);
      if (isSpecialUser) {
      }

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
        registrationUrl:
          typeof registrationUrl === "string" ? registrationUrl : fallbackUrl,
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
