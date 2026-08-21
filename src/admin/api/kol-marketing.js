/**
 * 管理后台 - KOL Marketing 只读状态 API
 *
 * KOL 检索联调页已下线；这里仅保留 KOL Match 配置页底部需要的
 * 数据覆盖、embedding 模型和只读从库健康状态。
 */

const express = require("express");
const { QueryTypes } = require("sequelize");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../infra/k8s/postgres-readonly");
const {
  getKolMarketingFilterLlmModel,
  getKolMarketingEmbeddingModel,
  isKolMarketingFilterLlmEnabled,
  MAX_LIMIT,
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

module.exports = router;
