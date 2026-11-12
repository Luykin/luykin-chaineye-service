const crypto = require("crypto");
const { Op } = require("sequelize");
const postgres = require("../../models/postgres-start");
const { loadVipLists, notifyRefresh } = require("../constants/xhuntVip");

const MIN_GRANT_MS = 12 * 60 * 60 * 1000;
const MAX_BATCH_SIZE = 100;
const TWITTER_ID_PATTERN = /^\d{1,30}$/;
const EXPLICIT_TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

class VipMembershipError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = "VipMembershipError";
    this.code = code;
    this.status = status;
  }
}

function normalizeRequiredString(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new VipMembershipError("INVALID_REQUEST", 400, `${field} is required and must not exceed ${maxLength} characters`);
  }
  return normalized;
}

function normalizeTwitterId(value) {
  const twitterId = String(value || "").trim();
  if (!TWITTER_ID_PATTERN.test(twitterId)) {
    throw new VipMembershipError("INVALID_TWITTER_ID", 400, "twitterId must be a numeric string");
  }
  return twitterId;
}

function addCalendarYears(value, years) {
  const result = new Date(value.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function normalizeExpiresAt(value, now) {
  const raw = String(value || "").trim();
  if (!raw || !EXPLICIT_TIMEZONE_PATTERN.test(raw)) {
    throw new VipMembershipError("INVALID_EXPIRES_AT", 400, "expiresAt must be ISO 8601 with an explicit timezone");
  }
  const expiresAt = new Date(raw);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new VipMembershipError("INVALID_EXPIRES_AT", 400, "expiresAt is invalid");
  }
  if (expiresAt.getTime() < now.getTime() + MIN_GRANT_MS) {
    throw new VipMembershipError("EXPIRES_AT_TOO_EARLY", 400, "expiresAt must be at least 12 hours from now");
  }
  if (expiresAt.getTime() > addCalendarYears(now, 5).getTime()) {
    throw new VipMembershipError("EXPIRES_AT_TOO_LATE", 400, "expiresAt must not exceed 5 calendar years from now");
  }
  return expiresAt;
}

function hashCanonical(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function parseStoredResponse(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") return JSON.parse(value);
  return {};
}

function createVipMembershipService({
  sequelize = postgres.pgInstance,
  VipUser = postgres.XhuntVipTestUser,
  VipOperation = postgres.XhuntVipOperation,
  clock = () => new Date(),
  refresh = async () => {
    await loadVipLists();
    await notifyRefresh();
  },
} = {}) {
  async function lockKey(transaction, namespace, value) {
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext(:lockKey))",
      { replacements: { lockKey: `${namespace}:${value}` }, transaction }
    );
  }

  async function replayOrConflict({ transaction, clientKey, orderNo, requestHash }) {
    const existing = await VipOperation.findOne({
      where: { clientKey, orderNo },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      const error = new VipMembershipError("IDEMPOTENCY_CONFLICT", 409, "order number has already been used with different parameters");
      error.requestHash = requestHash;
      throw error;
    }
    const response = parseStoredResponse(existing.responseJson);
    return {
      data: { ...response, replayed: true },
      meta: { requestHash, replayed: true },
    };
  }

  async function refreshAfterCommit() {
    try {
      await refresh();
    } catch (error) {
      console.error("[vip-membership] cache refresh failed after commit:", error.message);
    }
  }

  async function grant(input = {}) {
    const now = clock();
    const clientKey = normalizeRequiredString(input.clientKey, "clientKey", 64);
    const requestId = normalizeRequiredString(input.requestId, "requestId", 128);
    const orderNo = normalizeRequiredString(input.orderNo, "orderNo", 128);
    const twitterId = normalizeTwitterId(input.twitterId);
    const expiresAt = normalizeExpiresAt(input.expiresAt, now);
    const requestHash = hashCanonical({ action: "grant", twitterId, expiresAt: expiresAt.toISOString() });

    const result = await sequelize.transaction(async (transaction) => {
      await lockKey(transaction, "vip-order", `${clientKey}:${orderNo}`);
      const replay = await replayOrConflict({ transaction, clientKey, orderNo, requestHash });
      if (replay) return replay;

      await lockKey(transaction, "vip-twitter", twitterId);
      let membership = await VipUser.findOne({
        where: { listType: "vip", twitterId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const previousExpiresAt = membership?.vipExpiresAt || null;

      if (!membership) {
        membership = await VipUser.create({
          username: null,
          twitterId,
          listType: "vip",
          vipOrigin: "membership_api",
          vipExpiresAt: expiresAt,
          vipLastApiGrantedAt: now,
          vipLastApiOrderNo: orderNo,
        }, { transaction });
      } else {
        await membership.update({
          vipExpiresAt: expiresAt,
          vipLastApiGrantedAt: now,
          vipLastApiOrderNo: orderNo,
        }, { transaction });
      }

      const response = {
        orderNo,
        twitterId,
        previousExpiresAt: toIso(previousExpiresAt),
        expiresAt: expiresAt.toISOString(),
        grantedAt: now.toISOString(),
        replayed: false,
      };
      await VipOperation.create({
        clientKey,
        orderNo,
        action: "grant",
        twitterId,
        requestedExpiresAt: expiresAt,
        requestHash,
        previousExpiresAt,
        resultExpiresAt: expiresAt,
        executedAt: now,
        requestId,
        responseJson: response,
      }, { transaction });

      return { data: response, meta: { requestHash, replayed: false } };
    });

    if (!result.meta.replayed) await refreshAfterCommit();
    return result;
  }

  async function batchGet(rawTwitterIds) {
    if (!Array.isArray(rawTwitterIds) || rawTwitterIds.length === 0) {
      throw new VipMembershipError("INVALID_REQUEST", 400, "twitterIds must be a non-empty array");
    }
    if (rawTwitterIds.length > MAX_BATCH_SIZE) {
      throw new VipMembershipError("BATCH_TOO_LARGE", 400, `twitterIds must contain at most ${MAX_BATCH_SIZE} items`);
    }
    const twitterIds = [];
    const seen = new Set();
    for (const raw of rawTwitterIds) {
      const twitterId = normalizeTwitterId(raw);
      if (!seen.has(twitterId)) {
        seen.add(twitterId);
        twitterIds.push(twitterId);
      }
    }

    const rows = await VipUser.findAll({
      where: { listType: "vip", twitterId: { [Op.in]: twitterIds } },
    });
    const byTwitterId = new Map(rows.map((row) => [String(row.twitterId), row]));
    const nowMs = clock().getTime();
    return twitterIds.map((twitterId) => {
      const row = byTwitterId.get(twitterId);
      if (!row) return { twitterId, status: "not_found", isVip: false, expiresAt: null };
      const expiresAt = toIso(row.vipExpiresAt);
      const active = row.vipExpiresAt && new Date(row.vipExpiresAt).getTime() > nowMs;
      return {
        twitterId,
        status: active ? "active" : "expired",
        isVip: !!active,
        expiresAt,
      };
    });
  }

  async function forceExpire(input = {}) {
    const now = clock();
    const clientKey = normalizeRequiredString(input.clientKey, "clientKey", 64);
    const requestId = normalizeRequiredString(input.requestId, "requestId", 128);
    const orderNo = normalizeRequiredString(input.requestNo, "requestNo", 128);
    const twitterId = normalizeTwitterId(input.twitterId);
    const reason = normalizeRequiredString(input.reason, "reason", 255);
    const requestHash = hashCanonical({ action: "force_expire", twitterId, reason });

    const result = await sequelize.transaction(async (transaction) => {
      await lockKey(transaction, "vip-order", `${clientKey}:${orderNo}`);
      const replay = await replayOrConflict({ transaction, clientKey, orderNo, requestHash });
      if (replay) return replay;

      await lockKey(transaction, "vip-twitter", twitterId);
      const membership = await VipUser.findOne({
        where: { listType: "vip", twitterId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!membership) {
        throw new VipMembershipError("VIP_NOT_FOUND", 404, "VIP membership was not found");
      }

      const previousExpiresAt = membership.vipExpiresAt || null;
      const changed = !!previousExpiresAt && new Date(previousExpiresAt).getTime() > now.getTime();
      await membership.update({
        vipExpiresAt: now,
        vipForceExpiredAt: now,
      }, { transaction });

      const response = {
        requestNo: orderNo,
        twitterId,
        previousExpiresAt: toIso(previousExpiresAt),
        expiresAt: now.toISOString(),
        forceExpiredAt: now.toISOString(),
        changed,
        replayed: false,
      };
      await VipOperation.create({
        clientKey,
        orderNo,
        action: "force_expire",
        twitterId,
        requestedExpiresAt: null,
        requestHash,
        previousExpiresAt,
        resultExpiresAt: now,
        executedAt: now,
        requestId,
        responseJson: response,
      }, { transaction });
      return { data: response, meta: { requestHash, replayed: false } };
    });

    if (!result.meta.replayed) await refreshAfterCommit();
    return result;
  }

  async function listForAdmin(query = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
    const status = ["active", "expired", "all"].includes(query.status) ? query.status : "all";
    const origin = ["legacy_manual", "membership_api"].includes(query.origin) ? query.origin : null;
    const keyword = String(query.keyword || "").trim();
    const now = clock();
    const where = { listType: "vip" };
    if (status === "active") where.vipExpiresAt = { [Op.gt]: now };
    if (status === "expired") where.vipExpiresAt = { [Op.lte]: now };
    if (origin) where.vipOrigin = origin;
    if (keyword) {
      where[Op.or] = [
        { twitterId: { [Op.iLike]: `%${keyword}%` } },
        { username: { [Op.iLike]: `%${keyword.replace(/^@+/, "")}%` } },
      ];
    }

    const { count, rows } = await VipUser.findAndCountAll({
      where,
      order: [["vipExpiresAt", "DESC"], ["id", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        twitterId: row.twitterId,
        username: row.username || null,
        status: row.vipExpiresAt && new Date(row.vipExpiresAt).getTime() > now.getTime() ? "active" : "expired",
        expiresAt: toIso(row.vipExpiresAt),
        origin: row.vipOrigin,
        lastApiGrantedAt: toIso(row.vipLastApiGrantedAt),
        lastApiOrderNo: row.vipLastApiOrderNo || null,
        forceExpiredAt: toIso(row.vipForceExpiredAt),
        createdAt: toIso(row.createdAt),
      })),
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
      },
    };
  }

  return { grant, batchGet, forceExpire, listForAdmin };
}

const vipMembershipService = createVipMembershipService();

module.exports = {
  ...vipMembershipService,
  createVipMembershipService,
  VipMembershipError,
  constants: { MIN_GRANT_MS, MAX_BATCH_SIZE },
};
