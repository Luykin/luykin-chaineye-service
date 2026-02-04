const express = require("express");
const axios = require("axios");
const { Op } = require("sequelize");
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

const router = express.Router();

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

// 1) 通用活动报名
router.post(
  "/register",
  fingerprintLimiter,
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    try {
      const { campaign, invitedByCode, evmAddress, registrationUrl } =
        req.body || {};

      const normalizedCampaign = normalizeCampaign(campaign);
      if (!normalizedCampaign) {
        return res.status(400).json({ error: "campaign is required" });
      }

      let found = null;
      try {
        const cfgResp = await axios.get(
          "https://kb.xhunt.ai/nacos-configs?dataId=xhunt_campaigns&group=DEFAULT_GROUP",
          { timeout: 7000 }
        );
        const cfg = cfgResp && cfgResp.data ? cfgResp.data : null;
        if (!cfg || !Array.isArray(cfg.campaigns)) {
          return res.status(502).json({ error: "Failed to fetch campaigns config: incomplete data" });
        }
        found = cfg.campaigns.find(
          (c) => c && c.campaignKey === normalizedCampaign
        );
        if (!found) {
          return res.status(400).json({ error: "Invalid campaign identifier" });
        }
        if (!found.enabled) {
          return res.status(400).json({ error: "Campaign is not enabled" });
        }
        const now = new Date();
        const startAt = found.enrollmentWindow && found.enrollmentWindow.startAt ? new Date(found.enrollmentWindow.startAt) : null;
        const endAt = found.enrollmentWindow && found.enrollmentWindow.endAt ? new Date(found.enrollmentWindow.endAt) : null;
        if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
          return res.status(502).json({ error: "Invalid enrollment window in config" });
        }
        if (now < startAt || now > endAt) {
          return res.status(400).json({ error: "Not within the enrollment window" });
        }
      } catch (cfgErr) {
        console.error("Fetch campaigns config error:", cfgErr);
        return res.status(502).json({ error: "Campaign configuration service unavailable" });
      }

      const authedUserId = req.user && req.user.id;
      if (!authedUserId) {
        return res.status(401).json({ error: "未登录或 token 无效" });
      }
      const user = await XHuntUser.findByPk(authedUserId);
      if (!user) {
        return res.status(404).json({ error: "对应的用户不存在" });
      }

      if (!evmAddress || typeof evmAddress !== "string" || !evmAddress.trim()) {
        return res.status(400).json({ error: "EVM address is required" });
      }
      const trimmedAddress = evmAddress.trim();
      const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!evmAddressRegex.test(trimmedAddress)) {
        return res.status(400).json({ error: "Invalid EVM address format" });
      }

      if (req.redisClient) {
        try {
          const cooldownKey = `campaign:${normalizedCampaign}:register:cd:${user.id}`;
          const ttl = await req.redisClient.ttl(cooldownKey);
          if (typeof ttl === "number" && ttl > 0) {
            return res.status(429).json({
              error: `Too frequent requests, please try again in ${ttl}s`,
            });
          }
          await req.redisClient.setEx(cooldownKey, 10, "1");
        } catch (cdErr) {
          console.warn("Campaign register cooldown warn:", cdErr);
        }
      }

      // 检查报名门槛：threshold 和 includeCreator
      if (found && Number.isInteger(found.threshold)) {
        try {
          const twitterId = String(user.twitterId);
          if (!twitterId || twitterId === "null" || twitterId === "undefined") {
            return res.status(400).json({ error: "Invalid Twitter ID" });
          }

          const rankApiUrl = `https://data.cryptohunt.ai/fetch/twitter/rank?user_ids=${twitterId}`;
          const rankResponse = await axios.get(rankApiUrl, { timeout: 7000 });

          const rankData = rankResponse && rankResponse.data ? rankResponse.data : null;
          if (!rankData || !rankData.data || !Array.isArray(rankData.data) || rankData.data.length === 0) {
            return res.status(502).json({ error: "Failed to fetch user ranking data" });
          }

          const userRankData = rankData.data[0];
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
                return res.status(400).json({
                  error: `Does not meet registration threshold: KOL rank must be less than or equal to ${found.threshold}, current rank is ${kolRank}`
                });
              }
            }
          }
        } catch (rankErr) {
          console.error("Campaign register threshold check error:", rankErr);
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
        return res
          .status(409)
          .json({ error: "This EVM address is already in use" });
      }

      let inviter = null;
      const userHandle = (user.username || "").toLowerCase();
      const isSpecialUser = SPECIAL_ALLOWED_USERNAMES.has(userHandle);

      if (typeof invitedByCode === "string" && invitedByCode.trim()) {
        const code = invitedByCode.trim();
        if (code.toLowerCase() === SPECIAL_INVITE_CODE.toLowerCase()) {
          if (!isSpecialUser) {
            return res
              .status(403)
              .json({ error: "You are not a specially invited user" });
          }
        } else {
          inviter = await XHuntUser.findOne({
            where: { inviteCode: code },
          });
          if (!inviter) {
            return res.status(400).json({ error: "Invalid invite code" });
          }
          // 不能使用自己的邀请码
          if (inviter.id === user.id) {
            return res.status(400).json({ error: "Cannot use your own invite code" });
          }
        }
      }

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
            return res
              .status(502)
              .json({ error: "外部数据校验失败：返回数据不完整" });
          }

          const createdAt = new Date(data.created_at);
          if (Number.isNaN(createdAt.getTime())) {
            return res
              .status(502)
              .json({ error: "外部数据校验失败：创建时间无效" });
          }

          const now = new Date();
          const oneMonthAgo = new Date(now.getTime());
          oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

          if (createdAt > oneMonthAgo) {
            return res
              .status(400)
              .json({ error: "不满足条件：账号注册需早于1个月" });
          }

          if (data.followers_count < 50) {
            return res
              .status(400)
              .json({ error: "不满足条件：粉丝数量需不少于50" });
          }
        } catch (apiErr) {
          console.error("Campaign register profile check error:", apiErr);
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
        return res.status(409).json({ error: "您已报名，无需重复提交" });
      }

      if (!user.inviteCode) {
        let uniqueCode;
        try {
          uniqueCode = await ensureUniqueInviteCode();
        } catch (e) {
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
        invitedByCode: typeof invitedByCode === "string" ? invitedByCode : null,
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

      const { xHuntUserId: _omit, ...safeRecord } = record.toJSON();
      return res.json({
        success: true,
        inviteCode: user.inviteCode || null,
        registration: safeRecord,
      });
    } catch (err) {
      console.error("Campaign register error:", err);
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
    const result = await CampaignRegistration.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
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
      total: result.count,
      page,
      pageSize,
      rows: result.rows,
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

      let invitedCount = 0;
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
          invitedCount,
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

      const cacheKey = `campaign:${normalizedCampaign}:invites:count:${userId}`;
      let cachedCount = null;
      if (req.redisClient) {
        try {
          const raw = await req.redisClient.get(cacheKey);
          if (raw !== null && raw !== undefined) {
            cachedCount = parseInt(raw, 10);
            if (!Number.isNaN(cachedCount)) {
              invitedCount = cachedCount;
            }
          }
        } catch (redisGetErr) {
          console.error("Campaign redis GET invite count error:", redisGetErr);
        }
      }

      if (cachedCount === null) {
        try {
          invitedCount = await CampaignRegistration.count({
            where: {
              campaign: normalizedCampaign,
              invitedByUserId: userId,
            },
          });
          if (req.redisClient) {
            try {
              await req.redisClient.setEx(
                cacheKey,
                600,
                String(invitedCount)
              );
            } catch (redisSetErr) {
              console.error("Campaign redis SET invite count error:", redisSetErr);
            }
          }
        } catch (countErr) {
          console.error("Campaign invite count query error:", countErr);
        }
      }

      res.set("Cache-Control", "private, max-age=40");
      return res.status(200).json({
        registered: true,
        invitedCount,
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

module.exports = router;
