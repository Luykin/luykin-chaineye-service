const { Op, QueryTypes, fn, col } = require("sequelize");
const {
  E2eList,
  E2eRecord,
  E2eTweet,
  XHuntUser,
  AuthCenterXhuntIdentity,
} = require("../../../models/postgres-start");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../../infra/k8s/postgres-readonly");
const {
  calculateDepositAmounts,
  createExternalPaymentOrder,
  verifyExternalPayment,
} = require("./e2ePaymentService");
const { examineE2eTweet, parseTweetInput } = require("./e2eExamineService");

const PUBLIC_CAMPAIGN_STATUSES = ["active", "review", "complete"];
const DEFAULT_CAMPAIGN_PAGE_SIZE = 20;
const MAX_CAMPAIGN_PAGE_SIZE = 100;

function toNumber(val, fallback = 0) {
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
}

function formatCampaignItem(campaign, signups = [], tweetMap = new Map(), currentUserId = null) {
  const raw = typeof campaign.toJSON === "function" ? campaign.toJSON() : campaign;
  const tweetInfo = tweetMap.get(String(raw.tweet_id)) || null;

  const sortedSignups = [...signups].sort((a, b) => toNumber(b.point) - toNumber(a.point));
  const totalPoints = sortedSignups.reduce((acc, item) => acc + Math.max(0, toNumber(item.point)), 0);

  const leaderboard = sortedSignups.map((item) => {
    const r = typeof item.toJSON === "function" ? item.toJSON() : item;
    const pt = toNumber(r.point, 0);
    const mindshare = totalPoints > 0 ? Number(((pt / totalPoints) * 100).toFixed(2)) : 0;
    return {
      tweet_id: String(r.tweet_id || raw.tweet_id),
      user_id: String(r.user_id || ""),
      username: r.username || "",
      name: r.name || r.username || "",
      profile_image_url: r.profile_image_url || "",
      kol_rank: r.fan_rank !== null && r.fan_rank !== undefined ? Number(r.fan_rank) : null,
      point: pt,
      mindshare,
      rewards: r.rewards !== null && r.rewards !== undefined ? Number(r.rewards) : null,
      e2e_address: String(r.address || raw.address),
      user_address: r.user_address || null,
      create_time: r.create_time ? new Date(r.create_time).toISOString() : null,
      update_time: r.update_time ? new Date(r.update_time).toISOString() : null,
      explaination: r.explaination || null,
    };
  });

  const normalizedUserId = currentUserId ? String(currentUserId).trim() : "";
  const myItem = normalizedUserId
    ? leaderboard.find((item) => String(item.user_id) === normalizedUserId)
    : null;

  const current_user = myItem
    ? {
        ...myItem,
        signed_up: true,
      }
    : {
        tweet_id: String(raw.tweet_id),
        user_id: normalizedUserId || "",
        username: "",
        name: "",
        profile_image_url: "",
        kol_rank: null,
        point: 0,
        mindshare: 0,
        rewards: null,
        e2e_address: String(raw.address),
        user_address: null,
        create_time: null,
        update_time: null,
        signed_up: false,
      };

  const detail = {
    tweet_id: String(raw.tweet_id),
    user_id: String(raw.user_id || ""),
    owner_user_id: String(raw.owner_user_id || tweetInfo?.owner_user_id || raw.user_id || ""),
    owner_handle: raw.owner_handle || tweetInfo?.owner_handle || "",
    owner_image_url: raw.owner_image_url || tweetInfo?.owner_image_url || "",
    text: raw.text || tweetInfo?.text || "",
    html: tweetInfo?.html || null,
    summary_cn: raw.summary_cn || tweetInfo?.summary_cn || "",
    summary_en: raw.summary_en || tweetInfo?.summary_en || "",
    rewards: toNumber(raw.rewards, 0),
    fees: toNumber(raw.fees, 0),
    e2e_address: String(raw.address),
    address: String(raw.address),
    start_time: raw.start_time ? new Date(raw.start_time).toISOString() : null,
    end_time: raw.end_time ? new Date(raw.end_time).toISOString() : null,
    target: raw.target !== null && raw.target !== undefined ? Number(raw.target) : 200000,
    winners: raw.winners !== null && raw.winners !== undefined ? Number(raw.winners) : 20,
    status: String(raw.status || "active").toLowerCase(),
    complete_tx: raw.complete_tx || null,
    type: raw.type || "mindshare",
    lang: raw.lang || "all",
    retro: Boolean(raw.retro ?? true),
  };

  return {
    detail,
    current_user,
    leaderboard,
  };
}

/**
 * 获取当前所有进行中任务的 tweet_id 列表（对应 /pro/api/e2e_active）
 */
async function getActiveTweetIds() {
  const rows = await E2eList.findAll({
    where: { status: "active" },
    attributes: ["tweet_id"],
    order: [["start_time", "DESC"]],
  });
  return Array.from(new Set(rows.map((r) => String(r.tweet_id || "").trim()).filter(Boolean)));
}

function normalizeCampaignListOptions({ status = "all", page = 1, pageSize = DEFAULT_CAMPAIGN_PAGE_SIZE } = {}) {
  const normalizedStatus = String(status || "all").trim().toLowerCase();
  if (normalizedStatus !== "all" && !PUBLIC_CAMPAIGN_STATUSES.includes(normalizedStatus)) {
    const error = new Error("status 只能是 active、review、complete 或 all");
    error.status = 400;
    error.code = "E2E_INVALID_STATUS";
    throw error;
  }
  const normalizedPage = Math.max(1, parseInt(String(page), 10) || 1);
  const normalizedPageSize = Math.min(
    MAX_CAMPAIGN_PAGE_SIZE,
    Math.max(1, parseInt(String(pageSize), 10) || DEFAULT_CAMPAIGN_PAGE_SIZE)
  );
  return {
    status: normalizedStatus,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    offset: (normalizedPage - 1) * normalizedPageSize,
  };
}

/**
 * 按状态分页查询公开的 E2E 活动列表；all 包含 active / review / complete。
 */
async function listE2eActivities({ userId = null, status = "all", page = 1, pageSize = DEFAULT_CAMPAIGN_PAGE_SIZE } = {}) {
  const options = normalizeCampaignListOptions({ status, page, pageSize });
  const publicStatusWhere = { [Op.in]: PUBLIC_CAMPAIGN_STATUSES };
  const where = {
    status: options.status === "all" ? publicStatusWhere : options.status,
  };
  const [{ rows: campaigns, count }, statusRows] = await Promise.all([
    E2eList.findAndCountAll({
      where,
      order: [
        ["start_time", "DESC"],
        ["end_time", "DESC"],
      ],
      limit: options.pageSize,
      offset: options.offset,
    }),
    E2eList.findAll({
      where: { status: publicStatusWhere },
      attributes: ["status", [fn("COUNT", col("address")), "count"]],
      group: ["status"],
      raw: true,
    }),
  ]);

  const statusCounts = { active: 0, review: 0, complete: 0, all: 0 };
  for (const row of statusRows) {
    const key = String(row.status || "").toLowerCase();
    if (PUBLIC_CAMPAIGN_STATUSES.includes(key)) {
      statusCounts[key] = Number(row.count) || 0;
    }
  }
  statusCounts.all = PUBLIC_CAMPAIGN_STATUSES.reduce((sum, key) => sum + statusCounts[key], 0);

  const pagination = {
    page: options.page,
    pageSize: options.pageSize,
    total: Number(count) || 0,
    totalPages: count ? Math.ceil(Number(count) / options.pageSize) : 0,
    hasNextPage: options.page * options.pageSize < Number(count),
  };

  if (!campaigns.length) {
    return { status: options.status, list: [], pagination, statusCounts };
  }

  const addresses = campaigns.map((c) => String(c.address)).filter(Boolean);
  const tweetIds = Array.from(new Set(campaigns.map((c) => String(c.tweet_id)).filter(Boolean)));

  const [signups, tweets] = await Promise.all([
    E2eRecord.findAll({
      where: { address: { [Op.in]: addresses } },
    }),
    E2eTweet.findAll({
      where: { tweet_id: { [Op.in]: tweetIds } },
      attributes: [
        "tweet_id",
        "text",
        "html",
        "summary_cn",
        "summary_en",
        "owner_handle",
        "owner_image_url",
        "owner_user_id",
      ],
    }),
  ]);

  const signupsByAddress = new Map();
  for (const signup of signups) {
    const address = String(signup.address);
    if (!signupsByAddress.has(address)) signupsByAddress.set(address, []);
    signupsByAddress.get(address).push(signup);
  }

  const tweetMap = new Map();
  for (const tweet of tweets) {
    tweetMap.set(String(tweet.tweet_id), tweet.toJSON());
  }

  const list = campaigns.map((campaign) =>
    formatCampaignItem(
      campaign,
      signupsByAddress.get(String(campaign.address)) || [],
      tweetMap,
      userId
    )
  );

  return { status: options.status, list, pagination, statusCounts };
}

/**
 * 获取单个任务详情（支持按 address 或 tweet_id 查询）
 */
async function getE2eActivityDetail(idOrAddress, { userId = null } = {}) {
  const key = String(idOrAddress || "").trim();
  if (!key) return null;

  let campaign = await E2eList.findByPk(key);
  if (!campaign) {
    campaign = await E2eList.findOne({
      where: {
        tweet_id: key,
        status: { [Op.in]: ["active", "review", "complete"] },
      },
      order: [["start_time", "DESC"]],
    });
  }
  if (!campaign) return null;

  const [signups, tweetInfo] = await Promise.all([
    E2eRecord.findAll({ where: { address: String(campaign.address) } }),
    E2eTweet.findByPk(String(campaign.tweet_id)),
  ]);

  const tweetMap = new Map();
  if (tweetInfo) tweetMap.set(String(tweetInfo.tweet_id), tweetInfo.toJSON());

  return formatCampaignItem(campaign, signups, tweetMap, userId);
}

async function resolveTwitterUserMeta(twitterId) {
  const cleanId = String(twitterId || "").trim();
  if (!cleanId) return null;

  // 1. 优先尝试只读库 dev.twitter_user 获取最新排名和头像
  try {
    const status = getPostgresReadOnlyStatus();
    if (isPostgresReadOnlyConfigured() && status.ready) {
      const db = getPostgresReadOnlyInstance();
      const [row] = await db.query(
        `
          SELECT id::text, username, name, profile, feature
          FROM dev.twitter_user
          WHERE id::text = :twitterId
          LIMIT 1
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { twitterId: cleanId },
        }
      );
      if (row) {
        const profile = row.profile && typeof row.profile === "object" ? row.profile : {};
        const feature = row.feature && typeof row.feature === "object" ? row.feature : {};
        const rank =
          feature?.rank?.kolRank ??
          feature?.rank?.globalRank ??
          feature?.kol_info?.globalKolRank ??
          null;
        return {
          user_id: cleanId,
          username: row.username || profile.username || null,
          name: row.name || profile.name || row.username || null,
          profile_image_url:
            profile.profile_image_url ||
            profile.profile_image_url_https ||
            null,
          fan_rank: rank !== null && Number.isFinite(Number(rank)) ? Number(rank) : null,
        };
      }
    }
  } catch (_) {
    // fall through
  }

  // 2. 回退查主库 XHuntUser / AuthCenterXhuntIdentity
  try {
    const xhuntUser = await XHuntUser.findOne({ where: { twitterId: cleanId } });
    if (xhuntUser) {
      return {
        user_id: cleanId,
        username: xhuntUser.username || null,
        name: xhuntUser.displayName || xhuntUser.username || null,
        profile_image_url: xhuntUser.avatar || null,
        fan_rank: null,
      };
    }
    const identity = await AuthCenterXhuntIdentity.findOne({
      where: { provider: "twitter", providerSubject: cleanId },
    });
    if (identity) {
      return {
        user_id: cleanId,
        username: identity.username || null,
        name: identity.displayName || identity.username || null,
        profile_image_url: identity.avatar || null,
        fan_rank: null,
      };
    }
  } catch (_) {
    // ignore
  }

  return null;
}

/**
 * 报名参加 E2E 活动（对应 POST /pro/api/e2e/register）
 */
async function registerE2eParticipant(payload = {}) {
  const address = String(payload.address || payload.e2e_address || "").trim();
  const tweetIdInput = String(payload.tweet_id || "").trim();
  const userId = String(payload.user_id || "").trim();
  const userAddress = String(payload.user_address || "").trim();

  if (!userId) {
    return { success: false, message: "请先连接 X (Twitter) 账号后再报名" };
  }
  if (!userAddress) {
    return { success: false, message: "请先绑定或填写 EVM 收款钱包地址" };
  }

  let campaign = null;
  if (address) {
    campaign = await E2eList.findByPk(address);
  } else if (tweetIdInput) {
    campaign = await E2eList.findOne({
      where: { tweet_id: tweetIdInput, status: "active" },
      order: [["start_time", "DESC"]],
    });
  }

  if (!campaign) {
    return { success: false, message: "未找到对应的互动任务" };
  }
  if (String(campaign.status || "").toLowerCase() !== "active") {
    return { success: false, message: "该任务当前不在进行中，无法报名" };
  }

  const existing = await E2eRecord.findOne({
    where: {
      address: String(campaign.address),
      user_id: userId,
    },
  });
  if (existing) {
    return { success: true, message: "已报名成功", data: existing.toJSON() };
  }

  const userMeta = await resolveTwitterUserMeta(userId);
  const fanRank = userMeta?.fan_rank ?? null;

  const targetRank = Number(campaign.target || 0);
  if (targetRank > 0 && (!Number.isFinite(fanRank) || fanRank <= 0 || fanRank > targetRank)) {
    return {
      success: false,
      message: fanRank
        ? `当前账号 XHunt 排名 (#${fanRank}) 未达到该任务要求的 Top ${targetRank} 门槛`
        : "暂时无法获取当前账号的 XHunt 排名，请稍后重试",
    };
  }

  const now = new Date();
  const created = await E2eRecord.create({
    tweet_id: String(campaign.tweet_id),
    user_id: userId,
    fan_rank: fanRank,
    username: payload.username || userMeta?.username || null,
    name: payload.name || userMeta?.name || payload.username || userMeta?.username || null,
    point: 0,
    profile_image_url: payload.profile_image_url || userMeta?.profile_image_url || null,
    rewards: null,
    address: String(campaign.address),
    user_address: userAddress,
    create_time: now,
    update_time: now,
    explaination: null,
  });

  return {
    success: true,
    message: "报名成功",
    data: created.toJSON(),
  };
}

/**
 * 预创建 E2E 活动并返回专属充值地址（对应 POST /pro/api/e2e/create）
 * 状态初始为 'pending'，待 activate 验资通过后转为 'active'
 */
async function createE2eCampaign(payload = {}, options = {}) {
  const parsed = parseTweetInput(payload.tweet_url || payload.tweet_id);
  const tweetId = parsed.tweetId;
  if (!tweetId) {
    return { status: false, message: "无效的推文链接或推文 ID" };
  }

  const rewardsNum = Number(payload.rewards);
  if (!Number.isFinite(rewardsNum) || rewardsNum <= 0) {
    return { status: false, message: "奖池金额必须大于 0" };
  }

  const activeCampaign = await E2eList.findOne({
    where: { tweet_id: String(tweetId), status: "active" },
    attributes: ["tweet_id"],
  });
  if (activeCampaign) {
    return { status: false, message: "该推文已存在进行中的互动任务" };
  }

  const examineResult = await examineE2eTweet({
    tweet_id: tweetId,
    tweet_url: payload.tweet_url,
    identity: options.identity,
    fallbackOwner: options.fallbackOwner,
  });
  if (!examineResult.status) {
    return {
      status: false,
      message: examineResult.message || "该推文未通过合规审核",
    };
  }

  const tweetData = examineResult.data || {};
  const days = Math.min(7, Math.max(1, parseInt(String(payload.days || 2), 10) || 2));
  const target = payload.target !== undefined && payload.target !== null ? Number(payload.target) : 200000;
  const winners = Math.min(200, Math.max(1, parseInt(String(payload.winners || 20), 10) || 20));
  const type = String(payload.type || "mindshare").trim() || "mindshare";
  const lang = String(payload.lang || "all").trim() || "all";
  const retro = payload.retro !== undefined ? Boolean(payload.retro) : true;

  const { rewards, fees, depositRewards, feePercentage } = calculateDepositAmounts(rewardsNum);
  const paymentOrder = await createExternalPaymentOrder({
    tweetId: String(tweetId),
    rewards,
    fees,
    depositRewards,
  });
  const address = String(paymentOrder?.address || "").trim();
  if (!address) {
    return { status: false, message: "外部支付接口未返回有效的收款地址" };
  }

  const now = new Date();
  const endTime = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  endTime.setUTCHours(23, 59, 59, 999);

  const creatorUserId = String(
    payload.user_id ||
      options.fallbackOwner?.twitterId ||
      tweetData.owner_user_id ||
      tweetId
  );

  await E2eList.create({
    tweet_id: String(tweetId),
    user_id: creatorUserId,
    rewards,
    address,
    start_time: now,
    end_time: endTime,
    target,
    winners,
    text: tweetData.text || "",
    summary_cn: tweetData.summary_cn || "",
    summary_en: tweetData.summary_en || "",
    owner_handle: tweetData.owner_handle || parsed.handle || null,
    owner_image_url: tweetData.owner_image_url || null,
    owner_user_id: String(tweetData.owner_user_id || creatorUserId),
    status: "pending",
    complete_tx: null,
    type,
    fees,
    lang,
    retro,
  });

  return {
    status: true,
    address,
    deposit_rewards: depositRewards,
    fee_percentage: feePercentage,
    rewards,
    fees,
    tweet_id: String(tweetId),
  };
}

/**
 * 通过外部支付接口校验到账并激活活动（对应 POST /pro/api/e2e/activate）
 */
async function activateE2eCampaignInternal(payload = {}, { skipPaymentVerification = false } = {}) {
  const address = String(payload.address || "").trim();
  if (!address) {
    return { status: false, message: "缺少收款地址参数 address" };
  }

  const campaign = await E2eList.findByPk(address);
  if (!campaign) {
    return { status: false, message: "未找到该收款地址对应的待激活任务" };
  }

  const currentStatus = String(campaign.status || "").toLowerCase();
  if (currentStatus === "active") {
    return { status: true, message: "任务已激活", data: campaign.toJSON() };
  }
  if (currentStatus !== "pending") {
    return { status: false, message: "仅待支付任务可以执行激活操作" };
  }

  const duplicateActiveCampaign = await E2eList.findOne({
    where: {
      tweet_id: String(campaign.tweet_id),
      status: "active",
      address: { [Op.ne]: address },
    },
    attributes: ["tweet_id"],
  });
  if (duplicateActiveCampaign) {
    return { status: false, message: "该推文已存在进行中的互动任务" };
  }

  if (!skipPaymentVerification) {
    const requiredAmount = Number((toNumber(campaign.rewards) + toNumber(campaign.fees)).toFixed(6));
    const check = await verifyExternalPayment({ address, requiredAmount });
    if (!check.verified) {
      return {
        status: false,
        message: check.message || "外部支付接口尚未确认足额到账，请稍后重试",
        balance: check.balance,
        required: check.required,
      };
    }
  }

  // 根据原预设起止时间差重新计算激活后的正式 start_time / end_time
  const now = new Date();
  const origStart = campaign.start_time ? new Date(campaign.start_time).getTime() : now.getTime();
  const origEnd = campaign.end_time
    ? new Date(campaign.end_time).getTime()
    : now.getTime() + 2 * 24 * 60 * 60 * 1000;
  const durationMs = Math.max(24 * 60 * 60 * 1000, origEnd - origStart);
  const nextEnd = new Date(now.getTime() + durationMs);
  nextEnd.setUTCHours(23, 59, 59, 999);

  const [updatedCount] = await E2eList.update(
    {
      status: "active",
      start_time: now,
      end_time: nextEnd,
    },
    {
      where: { address, status: "pending" },
    }
  );
  if (updatedCount !== 1) {
    return { status: false, message: "任务状态已变化，请刷新后重试" };
  }

  const activatedCampaign = await E2eList.findByPk(address);
  return {
    status: true,
    message: skipPaymentVerification ? "管理员已跳过支付校验并激活任务" : "任务已成功激活",
    data: activatedCampaign.toJSON(),
  };
}

async function activateE2eCampaign(payload = {}) {
  return activateE2eCampaignInternal(payload);
}

async function forceActivateE2eCampaign(address) {
  return activateE2eCampaignInternal({ address }, { skipPaymentVerification: true });
}

module.exports = {
  getActiveTweetIds,
  listE2eActivities,
  getE2eActivityDetail,
  registerE2eParticipant,
  createE2eCampaign,
  activateE2eCampaign,
  forceActivateE2eCampaign,
};
