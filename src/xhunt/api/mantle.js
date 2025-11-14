const express = require("express");
const {
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
} = require("../middleware/security");
const {
  MantleRegistration2,
  XHuntUser,
} = require("../../models/postgres-start");
const {
  authenticateTokenOptional,
  authenticateToken,
} = require("../middleware/auth");
const axios = require("axios");
const { Op } = require("sequelize");

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
  // 最多尝试 5 次以避免极端碰撞
  for (let i = 0; i < 5; i += 1) {
    const code = generateInviteCode(10);
    // 校验唯一性
    const existed = await XHuntUser.findOne({ where: { inviteCode: code } });
    if (!existed) return code;
  }
  throw new Error("Failed to generate unique invite code");
}

// 特殊邀请码与允许用户
const SPECIAL_INVITE_CODE = "XHuntAI";
const SPECIAL_ALLOWED_USERNAMES = new Set([
  "sea_bitcoin",
  "floriat96249",
  "luoyukun4",
  "alpha_gege",
  "defiteddy2020",
  "maid_crypto",
  "paris13jeanne",
  "momochenming",
  "mimoo1201",
  "vvickym2",
  "web3annie",
  "charles48011843",
  "bocaibocai_",
  "0x_xifeng",
  "meta8mate",
  "zohanlin",
  "qqzsss",
  "0xallen888",
  "neohexwu",
  "scarlettweb3",
  "airdropalchemis",
  "timbro_bro",
  "blocktvbee",
  "0xmoon6626",
  "captain_kent",
  "border_crypto",
  "drbitcoin36",
  "bclaobai",
  "love_doge123",
  "0xcryptohowe",
  "monica_xiaom",
  "aisunny224737",
  "cyrus_g3",
  "0xjuliechen",
  "chaozuoye",
  "unaiyang",
  "viregeek",
  "ru7longcrypto",
  "eleveresearch",
  "0xjasonli",
  "dabiaogeggg",
  "kuigas",
  "tmel0211",
  "rocky_bitcoin",
  "btw0205",
  "fishkiller",
  "alvin0617",
  "0xbeyondlee",
  "cryptopainter_x",
  "0x_todd",
  "luyaoyuan1",
  "candydao_leaf",
  "web3feng",
  "jason_chen998",
  "wuhuoqiu",
  "broleonaus",
  "guomin184935",
  "jesse_meta",
]);

// 1) Mantle 活动报名接口（受限：指纹/浏览器/安全中间件）
router.post(
  "/register",
  fingerprintLimiter,
  browserOnlyMiddleware,
  authenticateToken,
  securityMiddleware,
  async (req, res) => {
    try {
      const { invitedByCode, evmAddress, registrationUrl, mark } =
        req.body || {};

      // 定位用户（仅使用 token）
      const authedUserId = req.user && req.user.id;
      if (!authedUserId) {
        return res.status(401).json({ error: "未登录或 token 无效" });
      }
      const user = await XHuntUser.findByPk(authedUserId);
      if (!user) {
        return res.status(404).json({ error: "对应的用户不存在" });
      }

      // const now = new Date(); // 本地时间，但可以转成 UTC 时间戳比较
      // const cutoffTime = new Date("2025-09-20T00:00:00Z"); // UTC 时间 00:00（北京时间 08:00）

      if (!mark || mark !== "MantleRegistration2") {
        return res.status(403).json({
          error:
            "(MantleRegistration1) Registration has closed, the event registration period has ended",
        });
      }

      // 8秒频率限制（按用户）
      if (req.redisClient) {
        try {
          const cooldownKey = `mantle:register:cd:${user.id}`;
          let ttl = await req.redisClient.ttl(cooldownKey);
          if (typeof ttl === "number" && ttl > 0) {
            return res.status(429).json({
              error: `Too frequent requests, please try again in ${ttl}s`,
            });
          }
          // 开启新的冷却窗口 10s
          await req.redisClient.setEx(cooldownKey, 10, "1");
        } catch (cdErr) {
          console.warn("Redis cooldown warn:", cdErr);
          // Redis 出错则不阻断，但继续流程
        }
      }

      // 校验EVM地址必填
      if (!evmAddress || typeof evmAddress !== "string" || !evmAddress.trim()) {
        return res.status(400).json({ error: "EVM address is required" });
      }

      // 校验EVM地址格式
      const trimmedAddress = evmAddress.trim();
      const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!evmAddressRegex.test(trimmedAddress)) {
        return res.status(400).json({ error: "Invalid EVM address format" });
      }

      // EVM地址查重校验（检查是否已被其他用户使用）
      const existingEVM = await MantleRegistration2.findOne({
        where: {
          evmAddress: trimmedAddress,
        },
      });
      if (existingEVM) {
        return res
          .status(409)
          .json({ error: "This EVM address is already in use" });
      }

      // 提前校验邀请码合法性
      let inviter = null;
      // 计算用户handle，避免重复计算
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
        }
      }

      // 外部数据校验：账号注册时间需≥1个月前，且粉丝数≥50
      // 特殊用户名单中的用户跳过外部数据校验

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
          console.error(
            "Mantle register profile check error:",
            apiErr?.message || apiErr
          );
          return res.status(502).json({ error: "外部数据校验请求失败" });
        }
      }

      // 已报名校验（同一用户或同一 twitterId 不允许重复报名）
      {
        const { Op } = require("sequelize");
        const existed = await MantleRegistration2.findOne({
          where: {
            [Op.or]: [{ xHuntUserId: user.id }, { twitterId: user.twitterId }],
          },
        });
        if (existed) {
          return res.status(409).json({ error: "您已报名，无需重复提交" });
        }
      }

      // 如该用户尚无邀请码，则生成并写入（生成失败则阻断报名）
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

      // 默认的报名来源网址可从 header 兜底
      const fallbackUrl = req.headers["x-window-location-href"]
        ? String(req.headers["x-window-location-href"])
        : null;

      // 组装报名记录
      const record = await MantleRegistration2.create({
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
        // registeredAt 由默认值生成
      });

      // 若存在邀请人，清除其邀请数缓存
      if (inviter && inviter.id && req.redisClient) {
        const cacheKey = `mantle:invites:count:${inviter.id}`;
        try {
          await req.redisClient.del(cacheKey);
        } catch (redisDelErr) {
          console.warn("Redis DEL invite count warn:", redisDelErr);
        }
      }

      const { xHuntUserId: _omit, ...safeRecord } = record.toJSON();
      return res.json({
        success: true,
        inviteCode: user.inviteCode || null,
        registration: safeRecord,
      });
    } catch (err) {
      console.error("Mantle register error:", err);
      return res
        .status(500)
        .json({ error: "服务器内部错误（mantle register）" });
    }
  }
);

// 2) 报名查询接口（无安全中间件）
router.get("/registrations-n7f2k4s4hy", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
      200
    );
    const { twitterId, startDate, endDate } = req.query || {};

    const where = {};
    if (twitterId) {
      where.twitterId = String(twitterId);
    }
    const { parseUtcDateParam } = require("../utils/date");

    const startDt = parseUtcDateParam(startDate);
    const endDt = parseUtcDateParam(endDate);
    if (startDt || endDt) {
      const { Op } = require("sequelize");
      const range = {};
      if (startDt) range[Op.gte] = startDt;
      if (endDt) range[Op.lte] = endDt;
      if (Object.keys(range).length > 0) {
        where.registeredAt = range;
      }
    }

    const offset = (page - 1) * pageSize;
    const result = await MantleRegistration2.findAndCountAll({
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
    console.error("Mantle registrations query error:", err);
    return res
      .status(500)
      .json({ error: "服务器内部错误（mantle registrations）" });
  }
});

// 3) 查询当前用户是否已报名
router.get(
  "/me",
  authenticateTokenOptional,
  browserOnlyMiddleware,
  securityMiddleware,
  async (req, res) => {
    try {
      // 获取总报名人数（所有情况下都要返回）
      let totalRegistrations = 0;
      try {
        totalRegistrations = await MantleRegistration2.count();
      } catch (countErr) {
        console.error("Total registrations count error:", countErr);
      }

      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(200).json({ registered: false, totalRegistrations });
      }
      // 统计当前用户已邀请的人数（带缓存）
      let invitedCount = 0;

      const record = await MantleRegistration2.findOne({
        where: { xHuntUserId: userId },
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
        return res
          .status(200)
          .json({ registered: false, invitedCount, totalRegistrations });
      }

      // 获取用户的 handle 信息
      let hunterData = null;
      if (req.user && req.user.username) {
        try {
          const response = await axios.post(
            "https://data.cryptohunt.ai/pro/api/hunter_by_handle",
            {
              campaign: "mantle",
              handle: req.user.username,
            },
            {
              timeout: 10000, // 设置10秒超时
            }
          );

          hunterData = response.data;
        } catch (hunterErr) {
          console.error("Hunter data fetch error:", hunterErr);

          // 根据错误类型返回相应的错误信息
          if (hunterErr.code === "ECONNABORTED") {
            return res.status(408).json({
              error: "获取 hunter 数据超时，请稍后重试",
              hunterDataError: "timeout",
            });
          } else if (hunterErr.response) {
            // 服务器返回了错误状态码
            return res.status(hunterErr.response.status).json({
              error: `获取 hunter 数据失败: ${hunterErr.response.status}`,
              hunterDataError: "api_error",
            });
          } else if (hunterErr.request) {
            // 请求已发出但没有收到响应
            return res.status(503).json({
              error: "无法连接到 hunter 数据服务，请稍后重试",
              hunterDataError: "connection_error",
            });
          } else {
            // 其他错误
            return res.status(500).json({
              error: "获取 hunter 数据时发生未知错误",
              hunterDataError: "unknown_error",
            });
          }
        }
      }

      const cacheKey = `mantle:invites:count:${userId}`;
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
          console.error("Redis GET invite count error:", redisGetErr);
        }
      }

      if (cachedCount === null) {
        try {
          invitedCount = await MantleRegistration2.count({
            where: { invitedByUserId: userId },
          });
          if (req.redisClient) {
            try {
              await req.redisClient.setEx(cacheKey, 600, String(invitedCount)); // 缓存10分钟
            } catch (redisSetErr) {
              console.error("Redis SET invite count error:", redisSetErr);
            }
          }
        } catch (countErr) {
          console.error("Invite count query error:", countErr);
        }
      }

      // 缓存策略：前端缓存 40s
      res.set("Cache-Control", "private, max-age=40");
      return res.status(200).json({
        registered: true,
        invitedCount,
        totalRegistrations,
        registration: record,
        hunterData,
      });
    } catch (err) {
      console.error("Mantle me query error:", err);
      return res.status(500).json({ error: "服务器内部错误（mantle me）" });
    }
  }
);

module.exports = router;
