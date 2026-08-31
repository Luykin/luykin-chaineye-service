const BOARD_STATUSES = Object.freeze({
  INITIALIZING: "initializing",
  MONITORING: "monitoring",
  PAUSED: "paused",
  DELETING: "deleting",
  DELETED: "deleted",
  FAILED: "failed",
});

const ACCESS_STATUSES = Object.freeze({
  ACTIVE: "active",
  REVOKED: "revoked",
});

const JOB_TYPES = Object.freeze({
  HISTORY_BACKFILL: "history_backfill",
  INCREMENTAL: "incremental",
  MANUAL_REFRESH: "manual_refresh",
  REANALYZE: "reanalyze",
});

const JOB_STATUSES = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
});

const RANGE_KEYS = Object.freeze(["24H", "7D", "30D"]);
const DEFAULT_RANGE_KEY = "7D";

const RANGE_CONFIG = Object.freeze({
  "24H": { ms: 24 * 60 * 60 * 1000, bucketSize: "hour" },
  "7D": { ms: 7 * 24 * 60 * 60 * 1000, bucketSize: "day" },
  "30D": { ms: 30 * 24 * 60 * 60 * 1000, bucketSize: "day" },
});

const POST_SOURCES = Object.freeze({
  MENTION: "mention",
  QUOTE: "quote",
  REPLY: "reply",
  COMMENT: "comment",
});

const ACCOUNT_SIGNAL_TYPES = Object.freeze({
  INFLUENTIAL_MENTION: "influential_mention",
  ACCOUNT_FOLLOWED_PROJECT: "account_followed_project",
  PROJECT_FOLLOWED_ACCOUNT: "project_followed_account",
  ACCOUNT_UNFOLLOWED_PROJECT: "account_unfollowed_project",
  PROJECT_UNFOLLOWED_ACCOUNT: "project_unfollowed_account",
});

const SENTIMENTS = Object.freeze({
  POSITIVE: "positive",
  NEUTRAL: "neutral",
  NEGATIVE: "negative",
  UNKNOWN: "unknown",
});

const ALERT_TYPES = Object.freeze({
  INFLUENTIAL_MENTION: "influential_mention",
  NEGATIVE_CONTENT: "negative_content",
  VOLUME_SPIKE: "volume_spike",
  NEGATIVE_SHARE_SPIKE: "negative_share_spike",
});

const SOCIAL_LISTENING_PERMISSION = "social-listening";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const EXPORT_MAX_ROWS = 10000;

module.exports = {
  BOARD_STATUSES,
  ACCESS_STATUSES,
  JOB_TYPES,
  JOB_STATUSES,
  RANGE_KEYS,
  DEFAULT_RANGE_KEY,
  RANGE_CONFIG,
  POST_SOURCES,
  ACCOUNT_SIGNAL_TYPES,
  SENTIMENTS,
  ALERT_TYPES,
  SOCIAL_LISTENING_PERMISSION,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  EXPORT_MAX_ROWS,
};
