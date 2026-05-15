const express = require("express");
const { Op } = require("sequelize");
const { body } = require("express-validator");
const {
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
} = require("../middleware/security");
const {
  UnregisteredUserRegistration,
} = require("../../models/postgres-start");
const { validateRequest } = require("../middleware/validate-request");
const {
  sanitizePlainText,
  sanitizeJsonStringsDeep,
} = require("../services/inputValidator");

const router = express.Router();

/**
 * POST /api/xhunt/user-entry
 * 未注册用户登记接口
 * 接收 Twitter 用户数据，保存到数据库
 */
router.post(
  "/",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  [
    body("id_str")
      .trim()
      .notEmpty()
      .withMessage("Twitter ID (id_str) 不能为空"),
  ],
  validateRequest,
  async (req, res) => {
    try {
      const userData = req.body;

      // 提取关键字段
      const twitterId = userData.id_str;
      const name = userData.name ? sanitizePlainText(userData.name, 255) : null;
      const screenName = userData.screen_name
        ? sanitizePlainText(userData.screen_name, 100)
        : null;
      const followersCount =
        typeof userData.followers_count === "number"
          ? userData.followers_count
          : null;

      // 提取 Twitter 账户创建时间
      let twitterCreatedAt = null;
      if (userData.created_at) {
        const parsedDate = new Date(userData.created_at);
        if (!isNaN(parsedDate.getTime())) {
          twitterCreatedAt = parsedDate;
        }
      }

      // 提取生日信息
      const birthdate = userData.birthdate
        ? sanitizeJsonStringsDeep(userData.birthdate)
        : null;
      const sanitizedRawData = sanitizeJsonStringsDeep(userData);

      // 验证 Twitter ID 是否已存在
      const existingRegistration =
        await UnregisteredUserRegistration.findOne({
          where: { twitterId },
        });

      if (existingRegistration) {
        // 如果已存在，更新数据
        await existingRegistration.update({
          name,
          screenName,
          followersCount,
          twitterCreatedAt,
          birthdate,
          rawData: sanitizedRawData,
        });

        return res.status(200).json({
          success: true,
          message: "登记信息已更新",
          data: {
            id: existingRegistration.id,
            twitterId: existingRegistration.twitterId,
            name: existingRegistration.name,
            screenName: existingRegistration.screenName,
            followersCount: existingRegistration.followersCount,
            twitterCreatedAt: existingRegistration.twitterCreatedAt,
            birthdate: existingRegistration.birthdate,
            createdAt: existingRegistration.createdAt,
            updatedAt: existingRegistration.updatedAt,
          },
        });
      }

      // 创建新登记记录
      const registration = await UnregisteredUserRegistration.create({
        twitterId,
        name,
        screenName,
        followersCount,
        twitterCreatedAt,
        birthdate,
        rawData: sanitizedRawData,
      });

      return res.status(201).json({
        success: true,
        message: "登记成功",
        data: {
          id: registration.id,
          twitterId: registration.twitterId,
          name: registration.name,
          screenName: registration.screenName,
          followersCount: registration.followersCount,
          twitterCreatedAt: registration.twitterCreatedAt,
          birthdate: registration.birthdate,
          createdAt: registration.createdAt,
          updatedAt: registration.updatedAt,
        },
      });
    } catch (error) {
      console.error("未注册用户登记失败:", error);
      return res.status(500).json({
        success: false,
        error: "登记失败",
        message: error.message,
      });
    }
  }
);

module.exports = router;
