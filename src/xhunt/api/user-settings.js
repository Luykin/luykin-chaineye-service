const express = require("express");
const { body, query } = require("express-validator");
const { validateRequest } = require("../middleware/validate-request");
const { authenticateToken } = require("../middleware/auth");
const { XHuntUserSettings } = require("../../models/postgres-start");

const router = express.Router();
const SETTINGS_CACHE_TTL_SEC = 600; // 10 分钟缓存
const MAX_SETTINGS_PAYLOAD_BYTES = 131072; // 最大 128KB 配置体积
const ALLOWED_CATEGORIES = ["all", "cleaner", "display", "features", "sidebars"];

// 系统默认缺省配置（当用户首次使用或重置时生效）
const DEFAULT_USER_SETTINGS = {
  cleaner: {
    enabled: true,
    mode: "mark", // 'mark' | 'hide'
    whitelist: [],
    customKeywords: [],
  },
  display: {
    language: "",
    avatarRankMode: "web3", // 'web3' | 'ai'
    showSidebarIcon: true,
    showAvatarRank: true,
    showTokenAnalysis: true,
    showTweetAIAnalysis: true,
    showSearchPanel: true,
    showAnnualReport: true,
    showFeatureSlot: true,
    showHotTrendingWeb3: true,
    showHotTrendingAi: true,
    showArticleBottomRightArea: true,
  },
  features: {
    showHunterCampaign: true,
    showOfficialTags: true,
    showNotes: true,
    showRealtimeSubscription: false,
    showEngageToEarn: true,
    enableBnbFeeds: true,
    enableGossip: true,
    enableListing: true,
  },
  sidebars: {
    showProjectMembers: true,
    showInvestors: true,
    showPortfolio: true,
    show90dMention: true,
    show90dPerformance: true,
    showPersonalityType: true,
    showRenameInfo: true,
    showDelInfo: true,
    showDiscussion: true,
    showKolAbilityModel: true,
    showSoulIndex: true,
    showNarrative: true,
    showReviews: true,
    showGhostFollowing: true,
    showAiAvatarButton: true,
  },
};

function isPlainObject(item) {
  return item && typeof item === "object" && !Array.isArray(item);
}

function deepMerge(target, source) {
  const output = Object.assign({}, target);
  if (isPlainObject(target) && isPlainObject(source)) {
    Object.keys(source).forEach((key) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return;
      }
      if (isPlainObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function getRedisKey(userId, category = "all") {
  return `xhunt:user_settings:${userId}:${category}`;
}

async function invalidateUserSettingsCache(redisClient, userId) {
  if (!redisClient?.del) return;
  try {
    const keys = ALLOWED_CATEGORIES.map((cat) => getRedisKey(userId, cat));
    await redisClient.del(keys).catch(() => null);
  } catch (err) {
    console.warn("[UserSettings] Invalidate cache warning:", err.message);
  }
}

/**
 * GET /api/xhunt/user/settings
 * 获取当前登录用户的配置信息
 */
router.get(
  "/",
  authenticateToken,
  [
    query("category")
      .optional()
      .trim()
      .isString()
      .isLength({ max: 64 })
      .toLowerCase()
      .isIn(ALLOWED_CATEGORIES)
      .withMessage(`category 仅支持: ${ALLOWED_CATEGORIES.join(", ")}`),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const category = (req.query.category || "all").trim().toLowerCase();
      const redisClient = req.redisClient || global.__xhuntRedis;
      const cacheKey = getRedisKey(userId, category);

      // 1. 尝试从 Redis 缓存读取
      if (redisClient) {
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            return res.json({
              success: true,
              data: JSON.parse(cached),
              source: "cache",
            });
          }
        } catch (cacheErr) {
          console.warn("[UserSettings] Redis get error:", cacheErr.message);
        }
      }

      // 2. 从数据库查询主记录
      const record = await XHuntUserSettings.findOne({
        where: { userId, category: "all" },
      });

      let responseData;
      if (record) {
        const fullSettings = deepMerge(DEFAULT_USER_SETTINGS, record.settings || {});
        responseData = {
          version: Number(record.version || 1),
          updatedAt: record.updatedAt,
          category,
          settings:
            category === "all"
              ? fullSettings
              : fullSettings[category] || DEFAULT_USER_SETTINGS[category] || {},
        };
      } else {
        // 无记录时返回系统默认配置
        responseData = {
          version: 0,
          updatedAt: null,
          category,
          settings:
            category === "all"
              ? DEFAULT_USER_SETTINGS
              : DEFAULT_USER_SETTINGS[category] || {},
        };
      }

      // 3. 异步回写 Redis
      if (redisClient) {
        redisClient
          .setEx(cacheKey, SETTINGS_CACHE_TTL_SEC, JSON.stringify(responseData))
          .catch(() => null);
      }

      return res.json({
        success: true,
        data: responseData,
        source: "db",
      });
    } catch (error) {
      console.error("[UserSettings] GET error:", error);
      return res.status(500).json({ success: false, error: "获取用户设置失败" });
    }
  }
);

/**
 * PUT /api/xhunt/user/settings
 * 保存或合并用户配置
 */
router.put(
  "/",
  authenticateToken,
  [
    body("category")
      .optional()
      .trim()
      .isString()
      .isLength({ max: 64 })
      .toLowerCase()
      .isIn(ALLOWED_CATEGORIES)
      .withMessage(`category 仅支持: ${ALLOWED_CATEGORIES.join(", ")}`),
    body("settings").isObject().withMessage("settings 必须为 JSON 对象"),
    body("clientUpdatedAt").optional().isISO8601().withMessage("clientUpdatedAt 必须为合法的 ISO8601 日期格式"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const category = (req.body.category || "all").trim().toLowerCase();
      const incomingSettings = req.body.settings;
      const clientUpdatedAt = req.body.clientUpdatedAt ? new Date(req.body.clientUpdatedAt) : new Date();

      // 体积防护限制
      const payloadString = JSON.stringify(incomingSettings);
      if (Buffer.byteLength(payloadString, "utf8") > MAX_SETTINGS_PAYLOAD_BYTES) {
        return res.status(413).json({
          success: false,
          error: `配置体积超限，单次不可超过 ${MAX_SETTINGS_PAYLOAD_BYTES / 1024} KB`,
        });
      }

      // 查找既有记录
      let record = await XHuntUserSettings.findOne({
        where: { userId, category: "all" },
      });

      let currentSettings = record?.settings ? { ...record.settings } : deepMerge({}, DEFAULT_USER_SETTINGS);

      // 合并逻辑
      if (category === "all") {
        currentSettings = deepMerge(currentSettings, incomingSettings);
      } else {
        currentSettings[category] = deepMerge(currentSettings[category] || {}, incomingSettings);
      }

      const nextVersion = (record ? Number(record.version || 0) : 0) + 1;

      if (record) {
        await record.update({
          settings: currentSettings,
          version: nextVersion,
          clientUpdatedAt,
        });
      } else {
        try {
          record = await XHuntUserSettings.create({
            userId,
            category: "all",
            settings: currentSettings,
            version: nextVersion,
            clientUpdatedAt,
          });
        } catch (createErr) {
          // 并发首次创建时捕获唯一约束冲突，重试查询并更新
          if (createErr.name === "SequelizeUniqueConstraintError") {
            record = await XHuntUserSettings.findOne({ where: { userId, category: "all" } });
            if (record) {
              const remerged = deepMerge(record.settings || {}, currentSettings);
              const retryVersion = Number(record.version || 0) + 1;
              await record.update({
                settings: remerged,
                version: retryVersion,
                clientUpdatedAt,
              });
              currentSettings = remerged;
            }
          } else {
            throw createErr;
          }
        }
      }

      // 失效 Redis 缓存
      const redisClient = req.redisClient || global.__xhuntRedis;
      await invalidateUserSettingsCache(redisClient, userId);

      return res.json({
        success: true,
        data: {
          version: nextVersion,
          updatedAt: record.updatedAt,
          category,
          settings: category === "all" ? currentSettings : currentSettings[category],
        },
      });
    } catch (error) {
      console.error("[UserSettings] PUT error:", error);
      return res.status(500).json({ success: false, error: "保存用户设置失败" });
    }
  }
);

/**
 * POST /api/xhunt/user/settings/reset
 * 重置指定类别或全量配置为默认值
 */
router.post(
  "/reset",
  authenticateToken,
  [
    body("category")
      .optional()
      .trim()
      .isString()
      .isLength({ max: 64 })
      .toLowerCase()
      .isIn(ALLOWED_CATEGORIES)
      .withMessage(`category 仅支持: ${ALLOWED_CATEGORIES.join(", ")}`),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const category = (req.body.category || "all").trim().toLowerCase();

      let record = await XHuntUserSettings.findOne({
        where: { userId, category: "all" },
      });

      let nextSettings;
      if (category === "all") {
        nextSettings = deepMerge({}, DEFAULT_USER_SETTINGS);
      } else {
        nextSettings = record?.settings ? { ...record.settings } : deepMerge({}, DEFAULT_USER_SETTINGS);
        nextSettings[category] = deepMerge({}, DEFAULT_USER_SETTINGS[category] || {});
      }

      const nextVersion = (record ? Number(record.version || 0) : 0) + 1;

      if (record) {
        await record.update({
          settings: nextSettings,
          version: nextVersion,
          clientUpdatedAt: new Date(),
        });
      } else {
        try {
          record = await XHuntUserSettings.create({
            userId,
            category: "all",
            settings: nextSettings,
            version: nextVersion,
            clientUpdatedAt: new Date(),
          });
        } catch (createErr) {
          if (createErr.name === "SequelizeUniqueConstraintError") {
            record = await XHuntUserSettings.findOne({ where: { userId, category: "all" } });
            if (record) {
              const retryVersion = Number(record.version || 0) + 1;
              await record.update({
                settings: nextSettings,
                version: retryVersion,
                clientUpdatedAt: new Date(),
              });
            }
          } else {
            throw createErr;
          }
        }
      }

      const redisClient = req.redisClient || global.__xhuntRedis;
      await invalidateUserSettingsCache(redisClient, userId);

      return res.json({
        success: true,
        data: {
          version: nextVersion,
          updatedAt: record.updatedAt,
          category,
          settings: category === "all" ? nextSettings : nextSettings[category],
        },
      });
    } catch (error) {
      console.error("[UserSettings] RESET error:", error);
      return res.status(500).json({ success: false, error: "重置用户设置失败" });
    }
  }
);

module.exports = router;
