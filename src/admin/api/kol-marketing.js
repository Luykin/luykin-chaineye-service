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
  getPostgresWriteInstance,
  getPostgresWriteStatus,
  isPostgresWriteConfigured,
} = require("../../infra/k8s/postgres-write");
const { requirePermission } = require("../middleware/adminAuth");
const {
  getKolMarketingFilterLlmModel,
  getKolMarketingEmbeddingModel,
  isKolMarketingFilterLlmEnabled,
  MAX_LIMIT,
} = require("../../xhunt/api/kol-marketing/search-service");

const router = express.Router();
const profileDebugGuard = requirePermission(["kol-match-config:read", "kol-match-config:write", "nacos-admin"]);

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

function normalizeProfileLookup(value) {
  const raw = String(value || "").trim().slice(0, 120);
  const urlHandleMatch = raw.match(/(?:x|twitter)\.com\/([a-zA-Z0-9_]{1,30})/i);
  const handleInput = (urlHandleMatch?.[1] || raw)
    .replace(/^@+/, "")
    .replace(/\/.*$/, "")
    .trim();
  const twitterId = /^\d{1,32}$/.test(raw) ? raw : "";
  const handle = /^[a-zA-Z0-9_]{1,30}$/.test(handleInput) && !/^\d+$/.test(handleInput)
    ? handleInput.toLowerCase()
    : "";

  return { raw, twitterId, handle };
}

function getProfileDebugDb() {
  const pgWrite = getPostgresWriteStatus();
  if (isPostgresWriteConfigured() && pgWrite.ready) {
    return {
      db: getPostgresWriteInstance(),
      source: "write",
      status: pgWrite,
    };
  }

  const pgRead = getPostgresReadOnlyStatus();
  if (isPostgresReadOnlyConfigured() && pgRead.ready) {
    return {
      db: getPostgresReadOnlyInstance(),
      source: "readonly",
      status: pgRead,
    };
  }

  const error = new Error("PG write/readonly connection is not ready");
  error.statusCode = 503;
  error.details = { pgWrite, pgRead };
  throw error;
}

function pickCollaborationFields(row) {
  if (!row) return null;
  return {
    acceptingNewInvitations: row.collaboration_accepting_new_invitations,
    telegram: row.collaboration_telegram,
    email: row.collaboration_email,
    shortPostPrice: row.collaboration_short_post_price,
    shortPostCurrency: row.collaboration_short_post_currency,
    threadPrice: row.collaboration_thread_price,
    threadCurrency: row.collaboration_thread_currency,
    updatedAt: row.collaboration_updated_at,
    syncedAt: row.collaboration_synced_at,
    source: row.collaboration_source,
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

router.get("/profile-debug", profileDebugGuard, async (req, res) => {
  const lookup = normalizeProfileLookup(req.query.query || req.query.q || req.query.twitterId || req.query.handle);
  if (!lookup.twitterId && !lookup.handle) {
    return res.status(400).json({
      success: false,
      error: "请输入 Twitter ID、@handle 或 x.com/handle",
    });
  }

  try {
    const { db, source, status } = getProfileDebugDb();
    const [row] = await db.query(
      `
        SELECT p.*
        FROM dev.kol_marketing_profile p
        WHERE
          ($twitterId::text IS NOT NULL AND p.twitter_user_id::text = $twitterId)
          OR ($handle::text IS NOT NULL AND lower(p.handle) = $handle)
        ORDER BY
          CASE
            WHEN $twitterId::text IS NOT NULL AND p.twitter_user_id::text = $twitterId THEN 0
            ELSE 1
          END,
          p.updated_at DESC NULLS LAST
        LIMIT 1
      `,
      {
        bind: {
          twitterId: lookup.twitterId || null,
          handle: lookup.handle || null,
        },
        type: QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      data: {
        query: lookup.raw,
        matchedBy: row ? (lookup.twitterId && String(row.twitter_user_id) === lookup.twitterId ? "twitterId" : "handle") : null,
        found: Boolean(row),
        source,
        checkedAt: new Date().toISOString(),
        dbStatus: status,
        collaboration: pickCollaborationFields(row),
        profile: row || null,
      },
    });
  } catch (error) {
    console.warn("[Admin KOL Marketing Profile Debug] query failed", {
      code: error.code || error.parent?.code || error.original?.code,
      message: error.message,
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "KOL Marketing Profile 查询失败",
    });
  }
});

module.exports = router;
