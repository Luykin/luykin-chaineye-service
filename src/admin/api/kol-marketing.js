/**
 * 管理后台 - KOL Marketing 向量检索测试 API
 *
 * 这个路由只给管理后台联调用：
 * - 复用正式 KOL Marketing search-service，确保测的是同一条 embedding + pgvector 链路；
 * - 使用 adminAuth 保护，不走 XHunt 插件 securityMiddleware；
 * - 不做写库，不扣普通用户每日搜索限额。
 */

const express = require("express");
const {
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../infra/k8s/postgres-readonly");
const {
  getKolMarketingEmbeddingModel,
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

router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: getServiceStatus(),
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

router.post("/normalize-filters", (req, res) => {
  res.json({
    success: true,
    data: normalizeFilters(req.body?.filters),
  });
});

module.exports = router;
