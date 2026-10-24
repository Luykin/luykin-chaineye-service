const { Op } = require("sequelize");
const {
  E2eList,
  E2eRecord,
  E2eSettlement,
  E2eSettlementItem,
  pgInstance,
} = require("../../../models/postgres-start");
const {
  EVM_ADDRESS_PATTERN,
  MAX_DISTRIBUTION_RECIPIENTS,
  aggregateDistributionRecipients,
  allocateUsdcMicros,
  formatUsdcMicros,
  toUsdcMicros,
} = require("./e2eMoney");
const {
  getExternalDistributionStatus,
  submitExternalDistribution,
} = require("./e2ePaymentService");
const { normalizeScoringConfig } = require("./e2eScoringConfig");

const MUTABLE_DRAFT_STATUS = "draft";
const PAYOUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function serviceError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function pointWeight(value) {
  const normalized = Number(value || 0);
  return BigInt(Math.max(0, Math.round(normalized * 100)));
}

function deterministicRankSort(a, b) {
  const pointDiff = Number(b.point || 0) - Number(a.point || 0);
  if (pointDiff !== 0) return pointDiff;
  const fanA = Number(a.fan_rank || Number.MAX_SAFE_INTEGER);
  const fanB = Number(b.fan_rank || Number.MAX_SAFE_INTEGER);
  if (fanA !== fanB) return fanA - fanB;
  return String(a.user_id).localeCompare(String(b.user_id));
}

function allocateItems(sourceItems, campaign) {
  const rewardMicros = toUsdcMicros(campaign.rewards || 0);
  const maxWinners = Math.max(1, Number(campaign.winners || 20));
  const items = sourceItems.map((item) => ({
    ...item,
    point: Number(item.point || 0),
    rank: null,
    reward_amount: "0.000000",
    is_winner: false,
  }));
  const eligible = items.filter((item) => !item.excluded && item.point > 0).sort(deterministicRankSort);
  eligible.forEach((item, index) => { item.rank = index + 1; });
  const winners = eligible.slice(0, maxWinners);
  if (winners.length && rewardMicros > 0n) {
    const equal = String(campaign.type || "mindshare").toLowerCase() === "equal";
    const allocations = allocateUsdcMicros(rewardMicros, winners.map((item) => ({
      userId: String(item.user_id),
      weight: equal ? 1n : pointWeight(item.point),
    })));
    allocations.forEach((allocation, index) => {
      winners[index].is_winner = true;
      winners[index].reward_amount = formatUsdcMicros(allocation.amount);
    });
  }
  return items;
}

function snapshotRecord(record, exclusion = null) {
  const source = record.toJSON ? record.toJSON() : record;
  const breakdown = source.score_breakdown || null;
  return {
    user_id: String(source.user_id),
    username: source.username || null,
    name: source.name || null,
    profile_image_url: source.profile_image_url || null,
    payout_address: source.user_address || null,
    fan_rank: source.fan_rank || null,
    point: Number(source.point || 0),
    excluded: Boolean(exclusion?.excluded),
    exclusion_reason: exclusion?.exclusion_reason || null,
    excluded_by: exclusion?.excluded_by || null,
    excluded_by_email: exclusion?.excluded_by_email || null,
    excluded_at: exclusion?.excluded_at || null,
    score_breakdown: breakdown,
    interactions: Array.isArray(breakdown?.interactions) ? breakdown.interactions : [],
  };
}

function copySettlementItem(item) {
  const source = item.toJSON ? item.toJSON() : item;
  return {
    user_id: String(source.user_id),
    username: source.username || null,
    name: source.name || null,
    profile_image_url: source.profile_image_url || null,
    payout_address: source.payout_address || null,
    fan_rank: source.fan_rank || null,
    point: Number(source.point || 0),
    excluded: Boolean(source.excluded),
    exclusion_reason: source.exclusion_reason || null,
    excluded_by: source.excluded_by || null,
    excluded_by_email: source.excluded_by_email || null,
    excluded_at: source.excluded_at || null,
    score_breakdown: source.score_breakdown || null,
    interactions: source.interactions || [],
  };
}

async function latestSettlement(address, { transaction, lock = false } = {}) {
  return E2eSettlement.findOne({
    where: { campaign_address: String(address) },
    order: [["revision", "DESC"]],
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
}

async function createRevision({ campaign, sourceItems, previous, transaction }) {
  const allocatedItems = allocateItems(sourceItems, campaign);
  const rewardPool = formatUsdcMicros(toUsdcMicros(campaign.rewards || 0));
  const feeAmount = formatUsdcMicros(toUsdcMicros(campaign.fees || 0));
  const depositAmount = formatUsdcMicros(toUsdcMicros(rewardPool) + toUsdcMicros(feeAmount));
  const payoutDueAt = new Date(new Date(campaign.end_time || Date.now()).getTime() + PAYOUT_WINDOW_MS);
  const revision = Number(previous?.revision || 0) + 1;
  if (previous && previous.status === MUTABLE_DRAFT_STATUS) {
    await previous.update({ status: "superseded", updated_at: new Date() }, { transaction });
  }
  const settlement = await E2eSettlement.create({
    campaign_address: String(campaign.address),
    revision,
    status: MUTABLE_DRAFT_STATUS,
    reward_pool: rewardPool,
    fee_amount: feeAmount,
    deposit_amount: depositAmount,
    winner_count: allocatedItems.filter((item) => item.is_winner).length,
    excluded_count: allocatedItems.filter((item) => item.excluded).length,
    unique_recipient_count: 0,
    calculation_config: {
      mode: campaign.type || "mindshare",
      winners: Number(campaign.winners || 20),
      usdcDecimals: 6,
      remainderPolicy: "largest_remainder_then_rank",
      duplicateWalletPolicy: "aggregate_case_insensitive",
      scorePolicyVersion: 3,
      scoringConfig: normalizeScoringConfig(campaign.score_config),
    },
    generated_at: new Date(),
    payout_due_at: payoutDueAt,
    distribution_status: "pending",
    created_at: new Date(),
    updated_at: new Date(),
  }, { transaction });
  await E2eSettlementItem.bulkCreate(allocatedItems.map((item) => ({
    ...item,
    settlement_id: settlement.id,
    campaign_address: String(campaign.address),
    created_at: new Date(),
  })), { transaction });

  await E2eRecord.update({ rewards: null }, { where: { address: String(campaign.address) }, transaction });
  for (const item of allocatedItems.filter((entry) => entry.is_winner)) {
    await E2eRecord.update(
      { rewards: item.reward_amount },
      { where: { address: String(campaign.address), user_id: String(item.user_id) }, transaction }
    );
  }
  return settlement;
}

async function generateSettlementDraft(campaignOrAddress, { force = false } = {}) {
  const address = typeof campaignOrAddress === "string"
    ? campaignOrAddress
    : String(campaignOrAddress?.address || "");
  if (!address) throw serviceError("E2E_CAMPAIGN_NOT_FOUND", 404, "E2E 活动不存在");
  return pgInstance.transaction(async (transaction) => {
    const campaign = await E2eList.findByPk(address, { transaction, lock: transaction.LOCK.UPDATE });
    if (!campaign) throw serviceError("E2E_CAMPAIGN_NOT_FOUND", 404, "E2E 活动不存在");
    const previous = await latestSettlement(address, { transaction, lock: true });
    if (previous && previous.status !== MUTABLE_DRAFT_STATUS && previous.status !== "superseded") {
      throw serviceError("E2E_SETTLEMENT_LOCKED", 409, "结算名单已确认，不能重新生成");
    }
    if (previous && previous.status === MUTABLE_DRAFT_STATUS && !force) return previous;

    const previousItems = previous
      ? await E2eSettlementItem.findAll({ where: { settlement_id: previous.id }, transaction })
      : [];
    const exclusions = new Map(previousItems.filter((item) => item.excluded).map((item) => [String(item.user_id), item]));
    const records = await E2eRecord.findAll({ where: { address }, transaction });
    const sourceItems = records.map((record) => snapshotRecord(record, exclusions.get(String(record.user_id))));
    return createRevision({ campaign, sourceItems, previous, transaction });
  });
}

async function reviseSettlementExclusion(address, itemId, { excluded, reason, admin }) {
  return pgInstance.transaction(async (transaction) => {
    const campaign = await E2eList.findByPk(address, { transaction, lock: transaction.LOCK.UPDATE });
    if (!campaign) throw serviceError("E2E_CAMPAIGN_NOT_FOUND", 404, "E2E 活动不存在");
    const previous = await latestSettlement(address, { transaction, lock: true });
    if (!previous) throw serviceError("E2E_SETTLEMENT_NOT_FOUND", 404, "尚未生成结算草稿");
    if (previous.status !== MUTABLE_DRAFT_STATUS) {
      throw serviceError("E2E_SETTLEMENT_LOCKED", 409, "结算名单已确认，不能修改排除状态");
    }
    const items = await E2eSettlementItem.findAll({ where: { settlement_id: previous.id }, transaction });
    const target = items.find((item) => String(item.id) === String(itemId));
    if (!target) throw serviceError("E2E_SETTLEMENT_ITEM_NOT_FOUND", 404, "结算用户不存在");
    if (excluded && !String(reason || "").trim()) {
      throw serviceError("E2E_EXCLUSION_REASON_REQUIRED", 400, "排除异常用户时必须填写原因");
    }
    const sourceItems = items.map(copySettlementItem);
    const replacement = sourceItems.find((item) => item.user_id === String(target.user_id));
    replacement.excluded = Boolean(excluded);
    replacement.exclusion_reason = excluded ? String(reason).trim() : null;
    replacement.excluded_by = excluded ? admin?.id || null : null;
    replacement.excluded_by_email = excluded ? admin?.email || null : null;
    replacement.excluded_at = excluded ? new Date() : null;
    return createRevision({ campaign, sourceItems, previous, transaction });
  });
}

async function getSettlementDetail(address) {
  const settlement = await latestSettlement(address);
  if (!settlement) return null;
  const items = await E2eSettlementItem.findAll({
    where: { settlement_id: settlement.id },
    order: [["excluded", "ASC"], ["rank", "ASC NULLS LAST"], ["point", "DESC"], ["user_id", "ASC"]],
  });
  return { settlement, items };
}

function buildDistributionRecipients(settlement, items) {
  const winners = items.filter((item) => item.is_winner && !item.excluded && Number(item.reward_amount || 0) > 0);
  if (!winners.length) throw serviceError("E2E_SETTLEMENT_NO_WINNERS", 409, "没有可发奖的获奖用户");
  const feeMicros = toUsdcMicros(settlement.fee_amount || 0);
  const feeAddress = String(process.env.E2E_FEE_RECIPIENT_ADDRESS || "").trim();
  if (feeMicros > 0n && !EVM_ADDRESS_PATTERN.test(feeAddress)) {
    throw serviceError("E2E_FEE_RECIPIENT_MISSING", 503, "未配置有效的 E2E 服务费收款地址");
  }
  let recipients;
  try {
    recipients = aggregateDistributionRecipients(
      winners.map((item) => ({
        address: item.payout_address,
        amountMicros: toUsdcMicros(item.reward_amount, { allowZero: false }),
      })),
      { feeAddress, feeMicros }
    );
  } catch (error) {
    if (error.message === "INVALID_RECIPIENT_ADDRESS") {
      throw serviceError("E2E_INVALID_WINNER_ADDRESS", 409, "获奖名单中存在无效收款地址，请先排除或修正");
    }
    throw error;
  }
  if (recipients.length > MAX_DISTRIBUTION_RECIPIENTS) {
    throw serviceError(
      "E2E_TOO_MANY_RECIPIENTS",
      409,
      `合并后收款地址超过 ${MAX_DISTRIBUTION_RECIPIENTS} 个`
    );
  }
  const total = recipients.reduce((sum, item) => sum + toUsdcMicros(item.amount), 0n);
  if (total !== toUsdcMicros(settlement.deposit_amount)) {
    throw serviceError("E2E_DISTRIBUTION_TOTAL_MISMATCH", 409, "分发总额与支付订单金额不一致");
  }
  if (recipients.some((item) => item.address.toLowerCase() === String(settlement.campaign_address).toLowerCase())) {
    throw serviceError("E2E_RECIPIENT_IS_CAMPAIGN_ADDRESS", 409, "收款地址不能与活动支付地址相同");
  }
  return recipients;
}

async function approveSettlement(address, admin) {
  return pgInstance.transaction(async (transaction) => {
    const campaign = await E2eList.findByPk(address, { transaction, lock: transaction.LOCK.UPDATE });
    if (!campaign) throw serviceError("E2E_CAMPAIGN_NOT_FOUND", 404, "E2E 活动不存在");
    if (String(campaign.status) !== "review") {
      throw serviceError("E2E_CAMPAIGN_NOT_REVIEW", 409, "只有待发奖活动可以确认名单");
    }
    const settlement = await latestSettlement(address, { transaction, lock: true });
    if (!settlement) throw serviceError("E2E_SETTLEMENT_NOT_FOUND", 404, "尚未生成结算草稿");
    if (settlement.status !== MUTABLE_DRAFT_STATUS) {
      throw serviceError("E2E_SETTLEMENT_ALREADY_APPROVED", 409, "当前结算版本已确认");
    }
    const items = await E2eSettlementItem.findAll({ where: { settlement_id: settlement.id }, transaction });
    const recipients = buildDistributionRecipients(settlement, items);
    await settlement.update({
      status: "approved",
      approved_by: admin?.id || null,
      approved_by_email: admin?.email || null,
      approved_at: new Date(),
      distribution_recipients: recipients,
      unique_recipient_count: recipients.length,
      updated_at: new Date(),
    }, { transaction });
    return settlement;
  });
}

function distributionStatusToSettlementStatus(status) {
  if (status === "confirmed") return "confirmed";
  if (status === "failed") return "failed";
  return "submitted";
}

async function applyProviderStatus(settlement, providerData) {
  const status = String(providerData.distribution_status || "pending").toLowerCase();
  const settlementStatus = distributionStatusToSettlementStatus(status);
  await pgInstance.transaction(async (transaction) => {
    await settlement.update({
      status: settlementStatus,
      distribution_status: status,
      tx_hash: providerData.tx_hash || settlement.tx_hash || null,
      confirmed_at: status === "confirmed" ? new Date() : settlement.confirmed_at,
      last_error: status === "failed" ? "E2E V2 distribution transaction failed" : null,
      provider_response: providerData,
      updated_at: new Date(),
    }, { transaction });
    if (status === "confirmed") {
      await E2eList.update(
        { status: "complete", complete_tx: providerData.tx_hash || settlement.tx_hash || null },
        { where: { address: settlement.campaign_address }, transaction }
      );
    }
  });
  return settlement;
}

async function submitSettlementDistribution(address, admin) {
  const settlement = await pgInstance.transaction(async (transaction) => {
    const current = await latestSettlement(address, { transaction, lock: true });
    if (!current) throw serviceError("E2E_SETTLEMENT_NOT_FOUND", 404, "尚未生成结算草稿");
    if (current.status !== "approved") {
      throw serviceError("E2E_SETTLEMENT_NOT_APPROVED", 409, "管理员确认获奖名单后才能触发分发");
    }
    const recipients = Array.isArray(current.distribution_recipients) ? current.distribution_recipients : [];
    if (!recipients.length) throw serviceError("E2E_SETTLEMENT_RECIPIENTS_MISSING", 409, "结算收款列表为空");
    await current.update({
      status: "submitting",
      submitted_by: admin?.id || null,
      submitted_by_email: admin?.email || null,
      submitted_at: new Date(),
      last_error: null,
      updated_at: new Date(),
    }, { transaction });
    return current;
  });
  try {
    const providerData = await submitExternalDistribution({
      address,
      recipients: settlement.distribution_recipients,
    });
    return applyProviderStatus(settlement, providerData);
  } catch (error) {
    await settlement.update({
      status: "approved",
      last_error: error.message || "提交分发失败",
      updated_at: new Date(),
    }).catch(() => {});
    throw error;
  }
}

async function refreshSettlementDistribution(address) {
  const settlement = await latestSettlement(address);
  if (!settlement) throw serviceError("E2E_SETTLEMENT_NOT_FOUND", 404, "尚未生成结算草稿");
  if (!["submitting", "submitted", "failed", "confirmed"].includes(settlement.status)) {
    throw serviceError("E2E_DISTRIBUTION_NOT_SUBMITTED", 409, "奖励分发尚未提交");
  }
  const providerData = await getExternalDistributionStatus(address);
  return applyProviderStatus(settlement, providerData);
}

async function refreshPendingDistributions() {
  const settlements = await E2eSettlement.findAll({
    where: { status: { [Op.in]: ["submitting", "submitted"] } },
    limit: 50,
  });
  const results = await Promise.allSettled(settlements.map((item) => refreshSettlementDistribution(item.campaign_address)));
  return { checked: settlements.length, failed: results.filter((item) => item.status === "rejected").length };
}

module.exports = {
  allocateItems,
  approveSettlement,
  buildDistributionRecipients,
  generateSettlementDraft,
  getSettlementDetail,
  refreshPendingDistributions,
  refreshSettlementDistribution,
  reviseSettlementExclusion,
  submitSettlementDistribution,
};
