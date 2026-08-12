/**
 * ============================================================================
 * XHunt KOL Marketing Profile 向量检索接口
 * ============================================================================
 *
 * POST /api/xhunt/kol-marketing/search
 *
 * 业务 SQL 在同目录 search-service.js 中显式维护；
 * 通用层只负责只读连接、embedding 和 pgvector 工具。
 *
 * ============================================================================
 */

const express = require("express");
const { body } = require("express-validator");
const { validateRequest } = require("../../middleware/validate-request");
const { isRequestXHuntVip } = require("../../constants/xhuntVip");
const { getEffectiveIdentity } = require("../../utils/request-identity");
const {
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../../infra/k8s/postgres-readonly");
const {
  getKolMarketingEmbeddingModel,
  MAX_LIMIT,
  searchKolMarketingProfiles,
} = require("./search-service");

const router = express.Router();

function requireXHuntVip(req, res, next) {
  if (isRequestXHuntVip(req)) return next();

  return res.status(403).json({
    code: 403,
    error: "XHUNT_VIP_REQUIRED",
    message: "该功能仅限 XHunt VIP 用户使用",
    message_en: "This feature is available to XHunt VIP users only",
  });
}

router.use(requireXHuntVip);

// Redis 日限额 key 前缀，最终 key 形如：kol_marketing_search_limit:tw:123:2026-08-06
const RATE_LIMIT_PREFIX = "kol_marketing_search_limit";

function getDailyLimit() {
  // KOL_MARKETING_SEARCH_DAILY_LIMIT：KOL 搜索专用每日次数限制。
  // VECTOR_SEARCH_DAILY_LIMIT：向量检索通用兜底每日次数限制。
  const limit = Number(
    process.env.KOL_MARKETING_SEARCH_DAILY_LIMIT ||
      process.env.VECTOR_SEARCH_DAILY_LIMIT ||
      30
  );
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30;
}

function getRequestId(req) {
  return req.requestId || req.headers["x-request-id"] || req.headers["x-xhunt-web-request-id"] || "-";
}

function isConfigError(error) {
  return [
    "PG_READ_NOT_CONFIGURED",
    "VECTOR_EMBEDDING_NOT_CONFIGURED",
    "VECTOR_EMBEDDING_DIMENSION_MISMATCH",
  ].includes(error.code);
}

function sanitizeFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return {};
  }
  return filters;
}

function getServiceConfigError() {
  // 接口入口先做服务可用性检查：
  // 1. 只读从库是否配置；
  // 2. 只读从库启动校验是否 ready；
  // 3. embedding 模型是否配置。
  // 不满足时返回 503，避免进入后续 embedding/SQL 链路。
  if (!isPostgresReadOnlyConfigured()) {
    return "PG read-only connection is not configured";
  }

  const pgReadStatus = getPostgresReadOnlyStatus();
  if (!pgReadStatus.ready) {
    return pgReadStatus.error
      ? `PG read-only connection is not ready: ${pgReadStatus.error}`
      : "PG read-only connection is not ready";
  }

  if (!getKolMarketingEmbeddingModel()) {
    return "KOL marketing embedding model is not configured";
  }

  return "";
}

function getBeijingDateContext() {
  // 日限额按北京时间自然日计算，resetTime 返回下一天 00:00:00 的毫秒时间戳。
  const now = new Date();
  const beijingTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
  const today = beijingTime.toISOString().split("T")[0];
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    today,
    resetTime: tomorrow.getTime(),
    ttlSeconds: Math.max(1, Math.ceil((tomorrow - beijingTime) / 1000)),
  };
}

async function checkRateLimit(req) {
  // 优先使用 securityMiddleware 写入的有效身份；没有时再从请求里兜底提取。
  // 身份优先级在 request-identity 中统一维护：twitterId > fingerprint > anonymous。
  const identity = req.securityContext?.effectiveIdentity?.key
    ? req.securityContext.effectiveIdentity
    : getEffectiveIdentity(req);

  if (!identity.key) {
    return {
      allowed: false,
      status: 401,
      payload: {
        code: 401,
        message: "无法识别用户身份，请刷新页面后重试",
        message_en: "Unable to identify user identity, please refresh the page and try again",
      },
    };
  }

  const maxCalls = getDailyLimit();
  const { today, resetTime, ttlSeconds } = getBeijingDateContext();
  const key = `${RATE_LIMIT_PREFIX}:${identity.key}:${today}`;

  // 当前日限额是粗粒度防刷逻辑；并发强一致扣减后续单独优化。
  const currentCount = parseInt((await req.redisClient.get(key)) || 0, 10);

  if (currentCount >= maxCalls) {
    return {
      allowed: false,
      status: 429,
      payload: {
        code: 429,
        message: `今日已使用 ${currentCount}/${maxCalls} 次，请明天再试`,
        message_en: `You have used ${currentCount}/${maxCalls} times today, please try again tomorrow`,
        resetTime,
      },
    };
  }

  const newCount = await req.redisClient.incr(key);
  if (newCount === 1) {
    await req.redisClient.expire(key, ttlSeconds);
  }

  return {
    allowed: true,
    total: maxCalls,
    used: newCount,
    remaining: Math.max(0, maxCalls - newCount),
    resetTime,
  };
}

router.post(
  "/search",
  [
    body("query")
      .isString()
      .withMessage("query 必须是字符串")
      .trim()
      .isLength({ min: 2, max: 500 })
      .withMessage("query 长度必须在 2-500 个字符之间"),
    body("filters")
      .optional()
      .custom((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("filters 必须是对象");
        }
        return true;
      }),
    body("limit")
      .optional()
      .isInt({ min: 1, max: MAX_LIMIT })
      .withMessage(`limit 必须是 1-${MAX_LIMIT} 的整数`),
    validateRequest,
  ],
  async (req, res) => {
    const requestId = getRequestId(req);
    const startedAt = Date.now();

    try {
      const serviceConfigError = getServiceConfigError();
      if (serviceConfigError) {
        console.warn("[KOL Marketing Search] service config missing", {
          requestId,
          reason: serviceConfigError,
        });

        return res.status(503).json({
          code: 503,
          message: "KOL 搜索服务未配置或暂不可用",
          message_en: "KOL search service is not configured or temporarily unavailable",
        });
      }

      // 搜索主链路：
      // 1. 先扣日限额；
      // 2. 清洗 query/filters/limit；
      // 3. 生成 query embedding；
      // 4. 走只读从库 pgvector HNSW 检索；
      // 5. 返回相似度和业务画像字段。
      const rateLimit = await checkRateLimit(req);
      if (!rateLimit.allowed) {
        return res.status(rateLimit.status).json(rateLimit.payload);
      }

      const query = String(req.body.query || "").trim();
      const filters = sanitizeFilters(req.body.filters);
      const limit = req.body.limit;

      const searchResult = await searchKolMarketingProfiles({
        query,
        filters,
        limit,
        redisClient: req.redisClient,
      });

      const totalCostMs = Date.now() - startedAt;

      console.log("[KOL Marketing Search] success", {
        requestId,
        queryLength: query.length,
        embeddingModel: searchResult.embeddingModel,
        embeddingCacheHit: searchResult.embeddingCacheHit,
        filterPlanSource: searchResult.filterPlan?.source,
        llmFilterCacheHit: searchResult.filterPlan?.llmCacheHit,
        filters: searchResult.filters,
        limit: searchResult.limit,
        resultCount: searchResult.items.length,
        dbCostMs: searchResult.dbCostMs,
        totalCostMs,
      });

      res.setHeader("X-RateLimit-Limit", rateLimit.total);
      res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
      res.setHeader("X-RateLimit-Reset", rateLimit.resetTime);

      res.json({
        code: 200,
        message: "success",
        data: {
          query,
          semanticQuery: searchResult.semanticQuery,
          filters: searchResult.filters,
          inputFilters: searchResult.inputFilters,
          llmFilters: searchResult.llmFilters,
          ruleFilters: searchResult.ruleFilters,
          derivedFilters: searchResult.derivedFilters,
          filterReasons: searchResult.filterReasons,
          filterPlan: searchResult.filterPlan,
          limit: searchResult.limit,
          embeddingModel: searchResult.embeddingModel,
          embeddingCacheHit: searchResult.embeddingCacheHit,
          quota: {
            total: rateLimit.total,
            used: rateLimit.used,
            remaining: rateLimit.remaining,
            resetTime: rateLimit.resetTime,
          },
          dbCostMs: searchResult.dbCostMs,
          totalCostMs,
          items: searchResult.items,
        },
      });
    } catch (error) {
      const totalCostMs = Date.now() - startedAt;
      const status = isConfigError(error) ? 503 : 500;

      console.error("[KOL Marketing Search] failed", {
        requestId,
        code: error.code,
        message: error.message,
        totalCostMs,
      });

      res.status(status).json({
        code: status,
        message: status === 503 ? "KOL 搜索服务未配置或暂不可用" : "KOL 搜索失败，请稍后重试",
        message_en: status === 503 ? "KOL search service is not configured or temporarily unavailable" : "KOL search failed, please try again later",
      });
    }
  }
);

module.exports = router;
