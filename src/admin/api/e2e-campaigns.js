const express = require("express");
const { Op, fn, col } = require("sequelize");
const { requirePermission } = require("../middleware/adminAuth");
const {
  E2eList,
  E2eRecord,
  E2eTweet,
  E2eLog,
  E2eInteractionSubmission,
  E2eSettlement,
  E2eSettlementItem,
  E2eCrawlRun,
  pgInstance,
} = require("../../models/postgres-start");
const { logAdminAction } = require("../../xhunt/api/stats-routes/shared");
const { forceActivateE2eCampaign } = require("../../echohunt/e2e/services/e2eService");
const {
  getExternalDistributionExecutionInfo,
  verifyExternalPayment,
} = require("../../echohunt/e2e/services/e2ePaymentService");
const {
  getE2ePublishAccessMode,
  grantE2ePublishAccess,
  grantE2ePublishAccessGroup,
  listE2ePublishAccesses,
  revokeE2ePublishAccess,
  serializeE2ePublishAccess,
  setE2ePublishAccessMode,
} = require("../../echohunt/e2e/services/e2eAccessService");
const { calculateCampaignScores } = require("../../echohunt/e2e/services/e2eScoreService");
const { normalizeScoringConfig, validateScoringConfig } = require("../../echohunt/e2e/services/e2eScoringConfig");
const {
  approveSettlement,
  generateSettlementDraft,
  getSettlementDetail,
  refreshSettlementDistribution,
  reviseSettlementExclusion,
  submitSettlementDistribution,
} = require("../../echohunt/e2e/services/e2eSettlementService");

const router = express.Router();
const MANAGE_PERMISSION = "e2e-campaigns";
const CAMPAIGN_STATUSES = new Set(["pending", "active", "review", "complete"]);
const CAMPAIGN_TYPES = new Set(["mindshare", "equal"]);
const CAMPAIGN_LANGS = new Set(["all", "zh", "cn", "en"]);
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const MAX_PAGE_SIZE = 100;
const MAX_AMOUNT = 1000000000;
const MAX_TARGET = 1000000000000;
const MAX_WINNERS = 200;

router.use(express.json({ limit: "1mb" }));
router.use(requirePermission(MANAGE_PERMISSION));

router.get("/publish-accesses", async (req, res) => {
  try {
    const status = text(req.query.status, 32);
    if (status && !["active", "revoked"].includes(status)) {
      throw publicError("status 只能是 active 或 revoked", 400, "E2E_PUBLISH_ACCESS_STATUS_INVALID");
    }
    return res.json({
      success: true,
      data: await listE2ePublishAccesses({ status: status || "active" }),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/publish-access-mode", async (req, res) => {
  try {
    return res.json({ success: true, data: await getE2ePublishAccessMode() });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put("/publish-access-mode", async (req, res) => {
  try {
    const mode = text(req.body?.mode, 32);
    const result = await setE2ePublishAccessMode(mode, req.adminUser?.id || null);
    await logAdminAction(req, {
      action: "e2e_publish_access_mode_update",
      success: true,
      message: `mode=${result.mode};changed=${result.changed}`,
    });
    return res.json({
      success: true,
      data: {
        mode: result.mode,
        changed: result.changed,
        access: result.access ? serializeE2ePublishAccess(result.access) : null,
      },
    });
  } catch (error) {
    await logAdminAction(req, {
      action: "e2e_publish_access_mode_update",
      success: false,
      message: error.message || "failed",
    }).catch(() => {});
    return sendError(res, error);
  }
});

router.post("/publish-accesses", async (req, res) => {
  try {
    const result = await grantE2ePublishAccess(req.body || {}, req.adminUser?.id || null);
    await logAdminAction(req, {
      action: "e2e_publish_access_grant",
      success: true,
      message: `handle=@${result.access.twitterHandle};created=${result.created}`,
    });
    return res.status(result.created ? 201 : 200).json({
      success: true,
      data: { access: serializeE2ePublishAccess(result.access), created: result.created },
    });
  } catch (error) {
    await logAdminAction(req, {
      action: "e2e_publish_access_grant",
      success: false,
      message: error.message || "failed",
    }).catch(() => {});
    return sendError(res, error);
  }
});

router.post("/publish-accesses/bulk", async (req, res) => {
  try {
    const source = text(req.body?.source, 32);
    const result = await grantE2ePublishAccessGroup(source, req.adminUser?.id || null);
    await logAdminAction(req, {
      action: "e2e_publish_access_bulk_grant",
      success: true,
      message: `source=${result.source};total=${result.total};created=${result.created};existing=${result.existing};failed=${result.failed}`,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    await logAdminAction(req, {
      action: "e2e_publish_access_bulk_grant",
      success: false,
      message: error.message || "failed",
    }).catch(() => {});
    return sendError(res, error);
  }
});

router.delete("/publish-accesses/:accessId", async (req, res) => {
  try {
    const access = await revokeE2ePublishAccess(req.params.accessId, req.adminUser?.id || null);
    await logAdminAction(req, {
      action: "e2e_publish_access_revoke",
      success: true,
      message: `handle=@${access.twitterHandle}`,
    });
    return res.json({ success: true, data: serializeE2ePublishAccess(access) });
  } catch (error) {
    await logAdminAction(req, {
      action: "e2e_publish_access_revoke",
      success: false,
      message: error.message || "failed",
    }).catch(() => {});
    return sendError(res, error);
  }
});

function publicError(message, status = 400, code = "E2E_BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sendError(res, error) {
  const status = error.status || 500;
  return res.status(status).json({
    success: false,
    code: error.code || "E2E_INTERNAL_ERROR",
    message: error.message || "服务器内部错误",
  });
}

function text(value, max = 0) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  if (max && result.length > max) throw publicError(`字段长度不能超过 ${max}`);
  return result || null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parsePagination(query) {
  const page = Math.max(1, parseInt(String(query.page || 1), 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(query.pageSize || 20), 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function paginationMeta(page, pageSize, total) {
  const normalized = Number(total) || 0;
  return { page, pageSize, total: normalized, totalPages: normalized ? Math.ceil(normalized / pageSize) : 0 };
}

function parseAmount(value, field, { allowZero = false } = {}) {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : text(value, 32);
  if (!raw || !/^\d{1,10}(?:\.\d{1,6})?$/.test(raw)) {
    throw publicError(`${field} 必须是${allowZero ? "大于等于 0" : "大于 0"}且最多 6 位小数的金额`, 400, "E2E_INVALID_AMOUNT");
  }
  const num = Number(raw);
  if (!allowZero && num <= 0) throw publicError(`${field} 必须大于 0`, 400, "E2E_INVALID_AMOUNT");
  if (num > MAX_AMOUNT) throw publicError(`${field} 超出允许上限`, 400, "E2E_INVALID_AMOUNT");
  return raw;
}

function parseInteger(value, field, min, max, code) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw publicError(`${field} 必须是 ${min}-${max} 的整数`, 400, code);
  }
  return n;
}

function parseDateTime(value, field) {
  const result = new Date(value);
  if (value === null || value === undefined || value === "" || Number.isNaN(result.getTime())) {
    throw publicError(`${field} 格式不正确`, 400, "E2E_INVALID_TIME");
  }
  return result;
}

function serializeTweet(row) {
  if (!row) return null;
  const item = row.toJSON ? row.toJSON() : row;
  return {
    tweetId: String(item.tweet_id),
    text: item.text || "",
    summaryCn: item.summary_cn || "",
    summaryEn: item.summary_en || "",
    ownerHandle: item.owner_handle || "",
    ownerImageUrl: item.owner_image_url || null,
    ownerUserId: item.owner_user_id ? String(item.owner_user_id) : null,
    passed: item.passed === null || item.passed === undefined ? null : Boolean(item.passed),
    flags: {
      political: Boolean(item.political),
      sexual: Boolean(item.sexual),
      violence: Boolean(item.violence),
      abusive: Boolean(item.abusive),
    },
    explanation: item.explanation || null,
    html: item.html || null,
  };
}

function serializeCampaign(row, tweetRow = null, { participantCount = 0 } = {}) {
  const item = row.toJSON ? row.toJSON() : row;
  const tweet = tweetRow ? (tweetRow.toJSON ? tweetRow.toJSON() : tweetRow) : null;
  const rewards = toFiniteNumber(item.rewards);
  const fees = toFiniteNumber(item.fees);
  const fallback = (value, alt) => (value === null || value === undefined || value === "" ? alt ?? null : value);
  return {
    address: String(item.address),
    tweetId: item.tweet_id ? String(item.tweet_id) : null,
    userId: item.user_id ? String(item.user_id) : null,
    ownerUserId: fallback(item.owner_user_id, tweet?.owner_user_id),
    ownerHandle: fallback(item.owner_handle, tweet?.owner_handle) || "",
    ownerImageUrl: fallback(item.owner_image_url, tweet?.owner_image_url),
    text: fallback(item.text, tweet?.text) || "",
    summaryCn: fallback(item.summary_cn, tweet?.summary_cn) || "",
    summaryEn: fallback(item.summary_en, tweet?.summary_en) || "",
    rewards,
    fees,
    depositRewards: rewards !== null || fees !== null ? round6((rewards || 0) + (fees || 0)) : null,
    target: toFiniteNumber(item.target),
    winners: toFiniteNumber(item.winners),
    status: String(item.status || "").toLowerCase() || null,
    completeTx: item.complete_tx || null,
    type: item.type || null,
    lang: item.lang || null,
    retro: item.retro === null || item.retro === undefined ? null : Boolean(item.retro),
    scoreConfig: normalizeScoringConfig(item.score_config),
    startTime: toIso(item.start_time),
    endTime: toIso(item.end_time),
    participantCount,
  };
}

function serializeRecord(row) {
  const item = row.toJSON ? row.toJSON() : row;
  return {
    userId: String(item.user_id),
    address: String(item.address),
    tweetId: String(item.tweet_id),
    username: item.username || "",
    name: item.name || "",
    profileImageUrl: item.profile_image_url || null,
    fanRank: toFiniteNumber(item.fan_rank),
    point: toFiniteNumber(item.point),
    rewards: toFiniteNumber(item.rewards),
    userAddress: item.user_address || null,
    explanation: item.explaination || null,
    scoreBreakdown: item.score_breakdown || null,
    createTime: toIso(item.create_time),
    updateTime: toIso(item.update_time),
  };
}

function serializeSettlementItem(row) {
  const item = row.toJSON ? row.toJSON() : row;
  return {
    id: String(item.id),
    userId: String(item.user_id),
    username: item.username || "",
    name: item.name || "",
    profileImageUrl: item.profile_image_url || null,
    payoutAddress: item.payout_address || null,
    fanRank: toFiniteNumber(item.fan_rank),
    point: toFiniteNumber(item.point) || 0,
    rank: toFiniteNumber(item.rank),
    rewardAmount: String(item.reward_amount || "0.000000"),
    isWinner: Boolean(item.is_winner),
    excluded: Boolean(item.excluded),
    exclusionReason: item.exclusion_reason || null,
    excludedBy: item.excluded_by ? String(item.excluded_by) : null,
    excludedByEmail: item.excluded_by_email || null,
    excludedAt: toIso(item.excluded_at),
    scoreBreakdown: item.score_breakdown || null,
    interactions: Array.isArray(item.interactions) ? item.interactions : [],
  };
}

function serializeSettlement(row, items = [], distributionExecution = null) {
  const item = row.toJSON ? row.toJSON() : row;
  return {
    id: String(item.id),
    campaignAddress: String(item.campaign_address),
    revision: Number(item.revision),
    status: item.status,
    rewardPool: String(item.reward_pool),
    feeAmount: String(item.fee_amount),
    depositAmount: String(item.deposit_amount),
    winnerCount: Number(item.winner_count || 0),
    excludedCount: Number(item.excluded_count || 0),
    uniqueRecipientCount: Number(item.unique_recipient_count || 0),
    calculationConfig: item.calculation_config || {},
    distributionRecipients: item.distribution_recipients || [],
    generatedAt: toIso(item.generated_at),
    payoutDueAt: toIso(item.payout_due_at),
    approvedBy: item.approved_by ? String(item.approved_by) : null,
    approvedByEmail: item.approved_by_email || null,
    approvedAt: toIso(item.approved_at),
    submittedBy: item.submitted_by ? String(item.submitted_by) : null,
    submittedByEmail: item.submitted_by_email || null,
    submittedAt: toIso(item.submitted_at),
    distributionStatus: item.distribution_status,
    txHash: item.tx_hash || null,
    confirmedAt: toIso(item.confirmed_at),
    lastError: item.last_error || null,
    providerResponse: item.provider_response || null,
    distributionExecution,
    items: items.map(serializeSettlementItem),
  };
}

async function loadSettlementResponse(address) {
  const detail = await getSettlementDetail(address);
  if (!detail) return null;
  const distributionExecution = detail.settlement.tx_hash
    ? await getExternalDistributionExecutionInfo(detail.settlement.tx_hash)
    : null;
  return serializeSettlement(detail.settlement, detail.items, distributionExecution);
}

async function computeStats(address, { transaction } = {}) {
  const row = await E2eRecord.findOne({
    where: { address },
    attributes: [
      [fn("COUNT", col("user_id")), "participantCount"],
      [fn("COALESCE", fn("SUM", col("point")), 0), "totalPoints"],
      [fn("COALESCE", fn("SUM", col("rewards")), 0), "allocatedRewards"],
      [fn("COUNT", col("rewards")), "winnerCount"],
    ],
    raw: true,
    transaction,
  });
  return {
    participantCount: Number(row?.participantCount || 0),
    totalPoints: round6(Number(row?.totalPoints || 0)),
    allocatedRewards: round6(Number(row?.allocatedRewards || 0)),
    winnerCount: Number(row?.winnerCount || 0),
  };
}

async function loadCampaignDetail(address, { transaction } = {}) {
  const key = String(address || "").trim();
  const campaign = await E2eList.findByPk(key, { transaction });
  if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
  const [tweet, stats] = await Promise.all([
    campaign.tweet_id ? E2eTweet.findByPk(String(campaign.tweet_id), { transaction }) : null,
    computeStats(key, { transaction }),
  ]);
  return {
    campaign: serializeCampaign(campaign, tweet, { participantCount: stats.participantCount }),
    tweet: serializeTweet(tweet),
    stats,
  };
}

router.get("/campaigns", async (req, res) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query);
    const where = {};
    const status = text(req.query.status, 32)?.toLowerCase();
    if (status) {
      if (!CAMPAIGN_STATUSES.has(status)) {
        throw publicError("status 只能是 pending、active、review 或 complete", 400, "E2E_INVALID_STATUS");
      }
      where.status = status;
    }
    const keyword = text(req.query.keyword, 200);
    if (keyword) {
      const like = `%${keyword}%`;
      where[Op.or] = ["tweet_id", "owner_handle", "address", "text", "summary_cn", "summary_en"].map((field) => ({
        [field]: { [Op.iLike]: like },
      }));
    }
    const { rows, count } = await E2eList.findAndCountAll({
      where,
      order: [
        ["start_time", "DESC"],
        ["end_time", "DESC"],
      ],
      limit: pageSize,
      offset,
    });
    const addresses = rows.map((row) => String(row.address)).filter(Boolean);
    const tweetIds = Array.from(new Set(rows.map((row) => String(row.tweet_id)).filter(Boolean)));
    const [tweets, participantRows, statusRows] = await Promise.all([
      tweetIds.length ? E2eTweet.findAll({ where: { tweet_id: { [Op.in]: tweetIds } } }) : [],
      addresses.length
        ? E2eRecord.findAll({
            where: { address: { [Op.in]: addresses } },
            attributes: ["address", [fn("COUNT", col("user_id")), "count"]],
            group: ["address"],
            raw: true,
          })
        : [],
      E2eList.findAll({
        attributes: ["status", [fn("COUNT", col("address")), "count"]],
        group: ["status"],
        raw: true,
      }),
    ]);
    const tweetById = new Map(tweets.map((tweet) => [String(tweet.tweet_id), tweet]));
    const participantByAddress = new Map(participantRows.map((row) => [String(row.address), Number(row.count) || 0]));
    const statusCounts = { pending: 0, active: 0, review: 0, complete: 0 };
    statusRows.forEach((row) => {
      const key = String(row.status || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(statusCounts, key)) statusCounts[key] += Number(row.count) || 0;
    });
    const statusTotal = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
    const list = rows.map((row) =>
      serializeCampaign(row, tweetById.get(String(row.tweet_id)) || null, {
        participantCount: participantByAddress.get(String(row.address)) || 0,
      })
    );
    return res.json({
      success: true,
      data: {
        list,
        pagination: paginationMeta(page, pageSize, count),
        statusCounts: { ...statusCounts, total: statusTotal },
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/campaigns/:address", async (req, res) => {
  try {
    return res.json({ success: true, data: await loadCampaignDetail(req.params.address) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/campaigns/:address/payment-status", async (req, res) => {
  try {
    const address = String(req.params.address || "").trim();
    const campaign = await E2eList.findByPk(address, {
      attributes: ["address", "status", "rewards", "fees"],
    });
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    const requiredAmount = round6(Number(campaign.rewards || 0) + Number(campaign.fees || 0));
    if (requiredAmount <= 0) {
      throw publicError("活动应付金额无效", 409, "E2E_PAYMENT_AMOUNT_INVALID");
    }
    const payment = await verifyExternalPayment({ address, requiredAmount });
    return res.json({
      success: true,
      data: {
        address,
        campaignStatus: String(campaign.status || "").toLowerCase(),
        requiredAmount: payment.required,
        paid: payment.paid,
        funded: payment.funded,
        verified: payment.verified,
        balance: payment.balance,
        message: payment.message,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/campaigns/:address/records", async (req, res) => {
  try {
    const address = String(req.params.address || "").trim();
    const campaign = await E2eList.findByPk(address, { attributes: ["address"] });
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, count } = await E2eRecord.findAndCountAll({
      where: { address },
      order: [
        ["point", "DESC"],
        ["update_time", "DESC"],
      ],
      limit: pageSize,
      offset,
    });
    return res.json({
      success: true,
      data: { list: rows.map(serializeRecord), pagination: paginationMeta(page, pageSize, count) },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/campaigns/:address/settlement", async (req, res) => {
  try {
    const address = String(req.params.address || "").trim();
    const campaign = await E2eList.findByPk(address, { attributes: ["address"] });
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    return res.json({ success: true, data: await loadSettlementResponse(address) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/campaigns/:address/settlement/recalculate", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const campaign = await E2eList.findByPk(address);
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    if (String(campaign.status) !== "review") {
      throw publicError("只有待发奖活动可以重新计算", 409, "E2E_CAMPAIGN_NOT_REVIEW");
    }
    await calculateCampaignScores(campaign, { skipStatusTransition: true });
    await generateSettlementDraft(address, { force: true });
    await logAdminAction(req, { action: "e2e_settlement_recalculate", success: true, message: `address=${address}` });
    return res.json({ success: true, data: await loadSettlementResponse(address) });
  } catch (error) {
    await logAdminAction(req, { action: "e2e_settlement_recalculate", success: false, message: `address=${address};${error.message}` }).catch(() => {});
    return sendError(res, error);
  }
});

router.patch("/campaigns/:address/settlement/items/:itemId/exclusion", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    if (typeof req.body?.excluded !== "boolean") {
      throw publicError("excluded 必须是布尔值", 400, "E2E_INVALID_EXCLUSION");
    }
    await reviseSettlementExclusion(address, req.params.itemId, {
      excluded: req.body.excluded,
      reason: text(req.body.reason, 500),
      admin: req.adminUser,
    });
    await logAdminAction(req, {
      action: req.body.excluded ? "e2e_settlement_exclude_user" : "e2e_settlement_restore_user",
      success: true,
      message: `address=${address};itemId=${req.params.itemId};reason=${text(req.body.reason, 500) || ""}`,
    });
    return res.json({ success: true, data: await loadSettlementResponse(address) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/campaigns/:address/settlement/approve", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const settlement = await approveSettlement(address, req.adminUser);
    await logAdminAction(req, { action: "e2e_settlement_approve", success: true, message: `address=${address};status=${settlement.status}` });
    return res.json({ success: true, data: await loadSettlementResponse(address) });
  } catch (error) {
    await logAdminAction(req, { action: "e2e_settlement_approve", success: false, message: `address=${address};${error.message}` }).catch(() => {});
    return sendError(res, error);
  }
});

router.post("/campaigns/:address/settlement/distribute", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    await submitSettlementDistribution(address, req.adminUser);
    await logAdminAction(req, { action: "e2e_settlement_distribute", success: true, message: `address=${address}` });
    return res.json({ success: true, data: await loadSettlementResponse(address) });
  } catch (error) {
    await logAdminAction(req, { action: "e2e_settlement_distribute", success: false, message: `address=${address};${error.message}` }).catch(() => {});
    return sendError(res, error);
  }
});

router.post("/campaigns/:address/settlement/refresh", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    await refreshSettlementDistribution(address);
    return res.json({ success: true, data: await loadSettlementResponse(address) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/campaigns/:address/diagnostics", async (req, res) => {
  try {
    const address = String(req.params.address || "").trim();
    const campaign = await E2eList.findByPk(address);
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    const [records, logs, submissions] = await Promise.all([
      E2eRecord.findAll({ where: { address }, order: [["point", "DESC"], ["user_id", "ASC"]], limit: 500 }),
      E2eLog.findAll({
        where: { address },
        order: [["calc_time", "DESC"]],
        limit: 100,
      }),
      E2eInteractionSubmission.findAll({
        where: { campaign_address: address },
        order: [["submitted_at", "DESC"], ["interaction_tweet_id", "ASC"]],
        limit: 500,
      }),
    ]);
    const scoreRows = records.map(serializeRecord);
    const scoredInteractions = scoreRows.flatMap((record) => {
      const details = Array.isArray(record.scoreBreakdown?.interactions) ? record.scoreBreakdown.interactions : [];
      return details.map((item) => [`${record.userId}:${item.id}`, item]);
    });
    const scoredByKey = new Map(scoredInteractions);
    const submissionRows = submissions.map((row) => {
      const item = row.toJSON();
      const scored = scoredByKey.get(`${item.user_id}:${item.interaction_tweet_id}`);
      return {
        id: String(item.id),
        tweetId: String(item.interaction_tweet_id),
        tweetUrl: item.interaction_url,
        type: item.interaction_type,
        status: item.status,
        userId: String(item.user_id),
        username: item.username || "",
        name: item.name || "",
        profileImageUrl: item.profile_image_url || null,
        text: item.text || "",
        interactionCreatedAt: toIso(item.interaction_created_at),
        submittedAt: toIso(item.submitted_at),
        verifiedAt: toIso(item.verified_at),
        lastRefreshedAt: toIso(item.last_refreshed_at),
        lastError: item.last_error || null,
        metrics: {
          likes: Number(item.likes || 0),
          replies: Number(item.replies || 0),
          retweets: Number(item.retweets || 0),
          quotes: Number(item.quotes || 0),
          views: Number(item.views || 0),
        },
        counted: scored ? Boolean(scored.counted) : false,
        score: scored ? Number(scored.score || 0) : null,
        reason: scored?.reason || (item.status === "verified" ? "等待下次算分" : "当前不可用于算分"),
      };
    });
    const refreshedTimes = submissions
      .map((item) => item.last_refreshed_at && new Date(item.last_refreshed_at))
      .filter((item) => item && !Number.isNaN(item.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return res.json({
      success: true,
      data: {
        submissionStats: {
          total: submissions.length,
          verified: submissions.filter((item) => item.status === "verified").length,
          replies: submissions.filter((item) => item.interaction_type === "reply").length,
          quotes: submissions.filter((item) => item.interaction_type === "quote").length,
          refreshFailed: submissions.filter((item) => Boolean(item.last_error)).length,
          oldestRefreshedAt: refreshedTimes.length ? refreshedTimes[0].toISOString() : null,
          latestRefreshedAt: refreshedTimes.length ? refreshedTimes[refreshedTimes.length - 1].toISOString() : null,
        },
        submissions: submissionRows,
        scores: scoreRows,
        scoreLogs: logs.map((row) => ({
          userId: String(row.user_id),
          username: row.username || "",
          point: toFiniteNumber(row.point),
          explanation: row.explanation || null,
          scoreBreakdown: row.score_breakdown || null,
          calculatedAt: toIso(row.calc_time),
        })),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put("/campaigns/:address/scoring-config", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const config = validateScoringConfig(req.body?.config);
    const campaign = await E2eList.findByPk(address);
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    const status = String(campaign.status || "").toLowerCase();
    if (status === "complete") {
      throw publicError("已完成活动不能修改评分规则", 409, "E2E_SCORING_CONFIG_LOCKED");
    }
    const currentSettlement = await getSettlementDetail(address);
    if (currentSettlement && currentSettlement.settlement.status !== "draft" && status === "review") {
      throw publicError("获奖名单已确认，评分规则已锁定", 409, "E2E_SCORING_CONFIG_LOCKED");
    }
    await campaign.update({ score_config: config });
    if (status === "active") {
      await calculateCampaignScores(campaign);
    } else if (status === "review") {
      await calculateCampaignScores(campaign, { skipStatusTransition: true });
      await generateSettlementDraft(address, { force: true });
    }
    await logAdminAction(req, {
      action: "e2e_scoring_config_update",
      success: true,
      message: `address=${address};status=${status};config=${JSON.stringify(config)}`,
    });
    return res.json({
      success: true,
      data: {
        detail: await loadCampaignDetail(address),
        settlement: await loadSettlementResponse(address),
      },
    });
  } catch (error) {
    await logAdminAction(req, { action: "e2e_scoring_config_update", success: false, message: `address=${address};${error.message}` }).catch(() => {});
    return sendError(res, error);
  }
});

router.put("/campaigns/:address", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const updates = {};
    if (has("rewards")) updates.rewards = parseAmount(body.rewards, "奖池金额");
    if (has("fees")) updates.fees = parseAmount(body.fees, "服务费", { allowZero: true });
    if (has("target")) updates.target = parseInteger(body.target, "排名门槛", 1, MAX_TARGET, "E2E_INVALID_TARGET");
    if (has("winners")) updates.winners = parseInteger(body.winners, "获奖人数", 1, MAX_WINNERS, "E2E_INVALID_WINNERS");
    if (has("type")) {
      const value = text(body.type, 32);
      if (!CAMPAIGN_TYPES.has(value)) throw publicError("type 只能是 mindshare 或 equal", 400, "E2E_INVALID_TYPE");
      updates.type = value;
    }
    if (has("lang")) {
      const value = text(body.lang, 32);
      if (!CAMPAIGN_LANGS.has(value)) throw publicError("lang 只能是 all、zh、cn 或 en", 400, "E2E_INVALID_LANG");
      updates.lang = value;
    }
    if (has("retro")) {
      if (typeof body.retro !== "boolean") throw publicError("retro 必须是布尔值", 400, "E2E_INVALID_RETRO");
      updates.retro = body.retro;
    }
    if (has("startTime")) updates.start_time = parseDateTime(body.startTime, "开始时间");
    if (has("endTime")) updates.end_time = parseDateTime(body.endTime, "结束时间");
    if (!Object.keys(updates).length) throw publicError("没有可更新的字段", 400, "E2E_NO_UPDATE_FIELDS");
    const detail = await pgInstance.transaction(async (transaction) => {
      const campaign = await E2eList.findByPk(address, { transaction, lock: transaction.LOCK.UPDATE });
      if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
      const status = String(campaign.status || "").toLowerCase();
      if ((updates.rewards !== undefined || updates.fees !== undefined) && status !== "pending") {
        throw publicError("仅待支付（pending）状态的活动可以修改奖池金额或服务费", 409, "E2E_CAMPAIGN_NOT_PENDING");
      }
      const finalStart = updates.start_time || campaign.start_time;
      const finalEnd = updates.end_time || campaign.end_time;
      if (finalStart && finalEnd && new Date(finalEnd).getTime() <= new Date(finalStart).getTime()) {
        throw publicError("结束时间必须晚于开始时间", 400, "E2E_INVALID_TIME_RANGE");
      }
      await campaign.update(updates, { transaction });
      return loadCampaignDetail(address, { transaction });
    });
    await logAdminAction(req, {
      action: "e2e_campaign_update",
      success: true,
      message: `address=${address};fields=${Object.keys(updates).join(",")}`,
    });
    return res.json({ success: true, data: detail });
  } catch (error) {
    await logAdminAction(req, { action: "e2e_campaign_update", success: false, message: `address=${address};${error.message}` }).catch(() => {});
    return sendError(res, error);
  }
});

router.delete("/campaigns/:address", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const confirmation = text(req.body?.confirmation, 256);
    if (!confirmation || confirmation !== address) {
      throw publicError("请输入完整活动地址确认删除", 400, "E2E_CAMPAIGN_DELETE_CONFIRMATION_INVALID");
    }
    const result = await pgInstance.transaction(async (transaction) => {
      const campaign = await E2eList.findByPk(address, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
      const deleted = {
        settlementItems: await E2eSettlementItem.destroy({ where: { campaign_address: address }, transaction }),
        settlements: await E2eSettlement.destroy({ where: { campaign_address: address }, transaction }),
        interactions: await E2eInteractionSubmission.destroy({ where: { campaign_address: address }, transaction }),
        crawlRuns: await E2eCrawlRun.destroy({ where: { campaign_address: address }, transaction }),
        records: await E2eRecord.destroy({ where: { address }, transaction }),
        scoreLogs: await E2eLog.destroy({ where: { address }, transaction }),
      };
      await campaign.destroy({ transaction });
      return {
        address,
        tweetId: campaign.tweet_id ? String(campaign.tweet_id) : null,
        status: String(campaign.status || "").toLowerCase() || null,
        deleted,
        tweetCacheDeleted: false,
        externalPaymentOrderDeleted: false,
      };
    });
    await logAdminAction(req, {
      action: "e2e_campaign_delete",
      success: true,
      message: `address=${address};status=${result.status};deleted=${JSON.stringify(result.deleted)}`,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    await logAdminAction(req, {
      action: "e2e_campaign_delete",
      success: false,
      message: `address=${address};${error.message}`,
    }).catch(() => {});
    return sendError(res, error);
  }
});

router.post("/campaigns/:address/force-activate", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const campaign = await E2eList.findByPk(address, { attributes: ["address", "status"] });
    if (!campaign) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
    if (String(campaign.status || "").toLowerCase() !== "pending") {
      throw publicError("仅待支付（pending）状态的活动可以强制确认支付", 409, "E2E_CAMPAIGN_NOT_PENDING");
    }

    const result = await forceActivateE2eCampaign(address);
    if (!result.status) {
      throw publicError(result.message || "强制激活活动失败", 409, "E2E_CAMPAIGN_FORCE_ACTIVATE_FAILED");
    }
    const detail = await loadCampaignDetail(address);
    await logAdminAction(req, {
      action: "e2e_campaign_force_activate",
      success: true,
      message: `address=${address};paymentVerification=skipped`,
    });
    return res.json({ success: true, data: detail });
  } catch (error) {
    await logAdminAction(req, {
      action: "e2e_campaign_force_activate",
      success: false,
      message: `address=${address};${error.message}`,
    }).catch(() => {});
    return sendError(res, error);
  }
});

router.post("/campaigns/:address/complete", async (req, res) => {
  const address = String(req.params.address || "").trim();
  try {
    const settlement = await getSettlementDetail(address);
    if (settlement) {
      throw publicError(
        "该活动已进入新版结算流程，请确认名单并通过 E2E V2 分发，不能手工标记完成",
        409,
        "E2E_MANUAL_COMPLETE_DISABLED"
      );
    }
    const txHash = text(req.body?.txHash, 128);
    if (!txHash || !TX_HASH_PATTERN.test(txHash)) {
      throw publicError("txHash 必须是 0x 开头的 64 位十六进制交易哈希", 400, "E2E_INVALID_TX_HASH");
    }
    const detail = await pgInstance.transaction(async (transaction) => {
      const [affected] = await E2eList.update(
        { status: "complete", complete_tx: txHash },
        { where: { address, status: "review" }, transaction }
      );
      if (!affected) {
        const existing = await E2eList.findByPk(address, { transaction, attributes: ["address", "status"] });
        if (!existing) throw publicError("E2E 活动不存在", 404, "E2E_CAMPAIGN_NOT_FOUND");
        throw publicError("仅 review 状态的活动可以标记完成", 409, "E2E_CAMPAIGN_NOT_REVIEW");
      }
      return loadCampaignDetail(address, { transaction });
    });
    await logAdminAction(req, {
      action: "e2e_campaign_complete",
      success: true,
      message: `address=${address};txHash=${txHash}`,
    });
    return res.json({ success: true, data: detail });
  } catch (error) {
    await logAdminAction(req, { action: "e2e_campaign_complete", success: false, message: `address=${address};${error.message}` }).catch(() => {});
    return sendError(res, error);
  }
});

module.exports = router;
