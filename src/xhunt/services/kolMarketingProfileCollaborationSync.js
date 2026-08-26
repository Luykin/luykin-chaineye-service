const { QueryTypes } = require("sequelize");
const { getPostgresWriteInstance } = require("../../infra/k8s/postgres-write");

function toNullableDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function getRecordJson(record) {
  return typeof record?.toJSON === "function" ? record.toJSON() : (record || {});
}

async function syncKolCollaborationToMarketingProfile(record) {
  const json = getRecordJson(record);
  const twitterId = String(json.twitterId || "").trim();
  if (!twitterId) {
    return { status: "skipped", reason: "TWITTER_ID_REQUIRED" };
  }

  const db = getPostgresWriteInstance();
  const rows = await db.query(
    `
      UPDATE dev.kol_marketing_profile
      SET
        collaboration_accepting_new_invitations = $acceptingNewInvitations,
        collaboration_telegram = $telegram,
        collaboration_email = $email,
        collaboration_short_post_price = $shortPostPrice,
        collaboration_short_post_currency = $shortPostCurrency,
        collaboration_thread_price = $threadPrice,
        collaboration_thread_currency = $threadCurrency,
        collaboration_updated_at = $collaborationUpdatedAt,
        collaboration_synced_at = now(),
        collaboration_source = 'echohunt_web'
      WHERE twitter_user_id::text = $twitterId
      RETURNING twitter_user_id::text AS "twitterUserId"
    `,
    {
      bind: {
        twitterId,
        acceptingNewInvitations: Boolean(json.acceptingNewInvitations),
        telegram: json.telegram || null,
        email: json.email || null,
        shortPostPrice: toNullableDecimal(json.shortPostPrice),
        shortPostCurrency: json.shortPostCurrency || "USDT",
        threadPrice: toNullableDecimal(json.threadPrice),
        threadCurrency: json.threadCurrency || "USDT",
        collaborationUpdatedAt: json.updatedAt || new Date(),
      },
      type: QueryTypes.SELECT,
    }
  );

  if (!rows.length) {
    return { status: "skipped", reason: "PROFILE_NOT_FOUND", twitterId };
  }

  return { status: "updated", twitterId };
}

module.exports = {
  syncKolCollaborationToMarketingProfile,
};
