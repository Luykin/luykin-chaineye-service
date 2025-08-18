const express = require("express");
const {
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
} = require("../middleware/security");
const {
  MantleRegistration,
  XHuntUser,
} = require("../../models/postgres-start");

const router = express.Router();

function generateInviteCode(length = 10) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
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

// 1) Mantle 活动报名接口（受限：指纹/浏览器/安全中间件）
router.post(
  "/register",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  async (req, res) => {
    try {
      const {
        xHuntUserId: bodyUserId,
        twitterId: bodyTwitterId,
        username,
        displayName,
        avatar,
        invitedByCode,
        evmAddress,
        registrationUrl,
      } = req.body || {};

      if (!bodyUserId && !bodyTwitterId) {
        return res
          .status(400)
          .json({ error: "xHuntUserId 或 twitterId 需要至少提供一个" });
      }

      // 定位用户
      let user = null;
      if (bodyUserId) {
        user = await XHuntUser.findByPk(bodyUserId);
      } else if (bodyTwitterId) {
        user = await XHuntUser.findOne({
          where: { twitterId: String(bodyTwitterId) },
        });
      }
      if (!user) {
        return res.status(404).json({ error: "对应的用户不存在" });
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
      const record = await MantleRegistration.create({
        xHuntUserId: user.id,
        twitterId: bodyTwitterId || user.twitterId,
        username: typeof username === "string" ? username : user.username,
        displayName:
          typeof displayName === "string" ? displayName : user.displayName,
        avatar: typeof avatar === "string" ? avatar : user.avatar,
        invitedByCode: typeof invitedByCode === "string" ? invitedByCode : null,
        evmAddress: typeof evmAddress === "string" ? evmAddress : null,
        registrationUrl:
          typeof registrationUrl === "string" ? registrationUrl : fallbackUrl,
        // registeredAt 由默认值生成
      });

      return res.json({
        success: true,
        inviteCode: user.inviteCode || null,
        registration: record,
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
router.get("/registrations", async (req, res) => {
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
    if (startDate || endDate) {
      where.registeredAt = {};
      if (startDate) where.registeredAt.$gte = new Date(startDate);
      if (endDate) where.registeredAt.$lte = new Date(endDate);
    }

    // Sequelize v6 写法需使用 Op
    const { Op } = require("sequelize");
    if (where.registeredAt) {
      const range = {};
      if (where.registeredAt.$gte) range[Op.gte] = where.registeredAt.$gte;
      if (where.registeredAt.$lte) range[Op.lte] = where.registeredAt.$lte;
      where.registeredAt = range;
    }

    const offset = (page - 1) * pageSize;
    const result = await MantleRegistration.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
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

module.exports = router;
