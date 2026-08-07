/**
 * 管理后台 - KOL Marketing 向量检索测试 API
 *
 * 这个路由只给管理后台联调用：
 * - 复用正式 KOL Marketing search-service，确保测的是同一条 embedding + pgvector 链路；
 * - 使用 adminAuth 保护，不走 XHunt 插件 securityMiddleware；
 * - 不做写库，不扣普通用户每日搜索限额。
 */

const express = require("express");
const { QueryTypes } = require("sequelize");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../infra/k8s/postgres-readonly");
const {
  buildKolMarketingSearchPlan,
  getKolMarketingFilterLlmModel,
  getKolMarketingEmbeddingModel,
  isKolMarketingFilterLlmEnabled,
  MAX_LIMIT,
  normalizeFilters,
  searchKolMarketingProfiles,
} = require("../../xhunt/api/kol-marketing/search-service");

const router = express.Router();

function getServiceStatus() {
  const pgConfigured = isPostgresReadOnlyConfigured();
  const pgRead = getPostgresReadOnlyStatus();
  const embeddingModel = getKolMarketingEmbeddingModel();

  return {
    ready: Boolean(pgConfigured && pgRead.ready && embeddingModel),
    pgConfigured,
    pgRead,
    embeddingModel: embeddingModel || null,
    filterLlm: {
      enabled: isKolMarketingFilterLlmEnabled(),
      model: getKolMarketingFilterLlmModel() || null,
    },
    maxLimit: MAX_LIMIT,
  };
}

function getConfigError(status = getServiceStatus()) {
  if (!status.pgConfigured) return "K8s PostgreSQL 只读从库未配置";
  if (!status.pgRead.ready) return status.pgRead.error || "K8s PostgreSQL 只读从库未就绪";
  if (!status.embeddingModel) return "KOL Marketing embedding 模型未配置";
  return "";
}

function sanitizeQuery(value) {
  return String(value || "").trim().slice(0, 500);
}

async function getProfileStats() {
  const db = getPostgresReadOnlyInstance();
  const [row] = await db.query(
    `
      SELECT
        COUNT(*)::integer AS "total",
        COUNT(*) FILTER (WHERE active)::integer AS "active",
        COUNT(*) FILTER (WHERE active AND marketing_profile_embedding IS NOT NULL)::integer AS "activeWithEmbedding",
        COUNT(*) FILTER (WHERE active AND marketing_profile_embedding IS NULL)::integer AS "activeMissingEmbedding",
        COUNT(*) FILTER (WHERE active AND needs_embedding_refresh)::integer AS "activeNeedsEmbeddingRefresh",
        COUNT(*) FILTER (WHERE active AND needs_ai_refresh)::integer AS "activeNeedsAiRefresh"
      FROM dev.kol_marketing_profile
    `,
    { type: QueryTypes.SELECT }
  );

  const active = Number(row.active || 0);
  const activeWithEmbedding = Number(row.activeWithEmbedding || 0);

  return {
    total: Number(row.total || 0),
    active,
    activeWithEmbedding,
    activeMissingEmbedding: Number(row.activeMissingEmbedding || 0),
    activeNeedsEmbeddingRefresh: Number(row.activeNeedsEmbeddingRefresh || 0),
    activeNeedsAiRefresh: Number(row.activeNeedsAiRefresh || 0),
    embeddingCoverage: active > 0 ? activeWithEmbedding / active : 0,
    checkedAt: new Date().toISOString(),
  };
}

router.get("/status", async (req, res) => {
  const status = getServiceStatus();
  let profileStats = null;
  let profileStatsError = null;

  if (status.pgConfigured && status.pgRead.ready) {
    try {
      profileStats = await getProfileStats();
    } catch (error) {
      profileStatsError = error.message || "KOL Marketing 表统计加载失败";
      console.warn("[Admin KOL Marketing Status] load profile stats failed", {
        code: error.code,
        message: error.message,
      });
    }
  }

  res.json({
    success: true,
    data: {
      ...status,
      profileStats,
      profileStatsError,
    },
  });
});

router.post("/search", async (req, res) => {
  const startedAt = Date.now();
  const status = getServiceStatus();
  const configError = getConfigError(status);

  if (configError) {
    return res.status(503).json({
      success: false,
      error: configError,
      code: "SERVICE_UNAVAILABLE",
      message: configError,
      data: status,
    });
  }

  try {
    const query = sanitizeQuery(req.body?.query);
    if (query.length < 2) {
      return res.status(400).json({
        success: false,
        error: "query 长度必须至少 2 个字符",
        code: "INVALID_QUERY",
        message: "query 长度必须至少 2 个字符",
      });
    }

    const result = await searchKolMarketingProfiles({
      query,
      filters: req.body?.filters,
      limit: req.body?.limit,
      redisClient: req.redisClient,
    });

    res.json({
      success: true,
      data: {
        ...result,
        serviceStatus: status,
        totalCostMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const totalCostMs = Date.now() - startedAt;
    console.error("[Admin KOL Marketing Search] failed", {
      code: error.code,
      status: error.status,
      message: error.message,
      totalCostMs,
    });

    const isConfigError = [
      "PG_READ_NOT_CONFIGURED",
      "VECTOR_EMBEDDING_NOT_CONFIGURED",
      "VECTOR_EMBEDDING_DIMENSION_MISMATCH",
    ].includes(error.code);

    res.status(isConfigError ? 503 : 500).json({
      success: false,
      error: error.message || "KOL Marketing 搜索失败",
      code: error.code || "KOL_MARKETING_SEARCH_FAILED",
      message: error.message || "KOL Marketing 搜索失败",
    });
  }
});

router.post("/normalize-filters", async (req, res) => {
  try {
    const query = sanitizeQuery(req.body?.query);
    const filterPlan = query
      ? await buildKolMarketingSearchPlan({
          query,
          filters: req.body?.filters,
          redisClient: req.redisClient,
        })
      : {
          explicitFilters: normalizeFilters(req.body?.filters),
          llmFilters: {},
          ruleFilters: {},
          derivedFilters: {},
          effectiveFilters: normalizeFilters(req.body?.filters),
          reasons: [],
          semanticQuery: "",
          filterPlan: {
            source: Object.keys(normalizeFilters(req.body?.filters)).length > 0 ? "explicit" : "semantic",
            llmEnabled: isKolMarketingFilterLlmEnabled(),
            llmAttempted: false,
            llmCacheHit: false,
            llmModel: getKolMarketingFilterLlmModel() || null,
            llmConfidence: 0,
            llmError: null,
            semanticQuery: "",
          },
        };

    res.json({
      success: true,
      data: filterPlan,
    });
  } catch (error) {
    console.error("[Admin KOL Marketing Normalize Filters] failed", {
      code: error.code,
      message: error.message,
    });

    res.status(500).json({
      success: false,
      error: error.message || "KOL Marketing 过滤条件归一化失败",
      code: error.code || "KOL_MARKETING_NORMALIZE_FILTERS_FAILED",
      message: error.message || "KOL Marketing 过滤条件归一化失败",
    });
  }
});

module.exports = router;
