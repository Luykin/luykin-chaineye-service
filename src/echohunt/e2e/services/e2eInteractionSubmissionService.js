const { Op } = require("sequelize");
const {
  E2eInteractionSubmission,
  E2eList,
  E2eRecord,
  pgInstance,
} = require("../../../models/postgres-start");
const { requestTwitterCrawler } = require("../../../xhunt/services/twitter-crawler");
const { normalizeScoringConfig } = require("./e2eScoringConfig");

const REFRESH_BATCH_SIZE = 5;

function interactionError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.publicMessage = message;
  return error;
}

function parseInteractionTweetUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input || input.length > 2048) {
    throw interactionError("E2E_INVALID_INTERACTION_URL", 400, "请输入有效的 X 评论或引用链接");
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw interactionError("E2E_INVALID_INTERACTION_URL", 400, "请输入有效的 X 评论或引用链接");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) {
    throw interactionError("E2E_INVALID_INTERACTION_URL", 400, "仅支持 x.com 或 twitter.com 的 HTTPS 链接");
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,30}|i\/web)\/status\/(\d{8,25})(?:\/)?$/i);
  if (!match) {
    throw interactionError("E2E_INVALID_INTERACTION_URL", 400, "链接必须是完整的 X Tweet 链接");
  }
  return {
    handle: match[1] === "i/web" ? null : match[1],
    tweetId: match[2],
  };
}

function findTweetPayload(value, tweetId) {
  if (!value || typeof value !== "object") return null;
  const currentId = String(value.id || value.tweet_id || "");
  if (currentId && currentId === String(tweetId)) return value;
  for (const key of ["tweet", "data"]) {
    const found = findTweetPayload(value[key], tweetId);
    if (found) return found;
  }
  if (Array.isArray(value.tweets)) {
    for (const item of value.tweets) {
      const found = findTweetPayload(item, tweetId);
      if (found) return found;
    }
  }
  return null;
}

function metric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeTweetDetail(raw, fallbackTweetId) {
  const profile = raw?.user_profile && typeof raw.user_profile === "object" ? raw.user_profile : {};
  const tweetId = String(raw?.id || raw?.tweet_id || fallbackTweetId || "");
  const createdAt = new Date(raw?.time_parsed || raw?.created_at || raw?.create_time || 0);
  return {
    tweetId,
    text: String(raw?.text || ""),
    authorId: String(profile.id || raw?.user_id || raw?.twitter_user_id || ""),
    username: String(profile.username || raw?.username || "").replace(/^@+/, "") || null,
    name: profile.name || raw?.name || null,
    profileImageUrl: profile.profile_image_url || raw?.profile_image_url || null,
    createdAt: Number.isNaN(createdAt.getTime()) ? null : createdAt,
    permanentUrl: raw?.permanent_url || null,
    replyTargetId: String(
      raw?.in_reply_to_status_id || raw?.in_reply_to_tweet_id || raw?.reply_id || ""
    ),
    quoteTargetId: String(
      raw?.quoted_status_id || raw?.quote_id || raw?.quoted_status?.id || ""
    ),
    metrics: {
      likes: metric(raw?.likes ?? raw?.statistic?.likes),
      replies: metric(raw?.reply_count ?? raw?.statistic?.reply_count),
      retweets: metric(raw?.retweet_count ?? raw?.statistic?.retweet_count),
      quotes: metric(raw?.quote_count ?? raw?.statistic?.quote_count),
      views: metric(raw?.views ?? raw?.statistic?.views),
    },
  };
}

async function fetchInteractionTweet(tweetId) {
  let response;
  try {
    response = await requestTwitterCrawler("tweet_detail", { tweet_id: String(tweetId) });
  } catch (error) {
    throw interactionError(
      "E2E_INTERACTION_NOT_FOUND",
      error?.response?.status === 404 ? 404 : 502,
      "暂时无法获取该互动，请确认链接公开可访问后重试"
    );
  }
  const body = response?.data || {};
  const tweet = findTweetPayload(body.data ?? body, tweetId);
  if (!tweet) {
    throw interactionError("E2E_INTERACTION_NOT_FOUND", 404, "未找到该评论或引用，请检查链接");
  }
  const detail = normalizeTweetDetail(tweet, tweetId);
  if (!detail.authorId || !detail.createdAt) {
    throw interactionError("E2E_INTERACTION_INVALID_RESPONSE", 502, "互动详情缺少作者或发布时间");
  }
  return detail;
}

function resolveInteractionType(detail, campaignTweetId) {
  const target = String(campaignTweetId);
  if (detail.replyTargetId === target) return "reply";
  if (detail.quoteTargetId === target) return "quote";
  if (detail.replyTargetId || detail.quoteTargetId) {
    throw interactionError(
      "E2E_INTERACTION_TARGET_MISMATCH",
      400,
      "该链接不是对本任务原推文的直接评论或引用"
    );
  }
  throw interactionError(
    "E2E_INTERACTION_TYPE_UNSUPPORTED",
    400,
    "仅支持提交对任务原推文的评论或引用，普通转推和独立推文不计分"
  );
}

function serializeInteractionSubmission(record, scoreDetail = null) {
  const item = record?.toJSON ? record.toJSON() : record;
  return {
    id: String(item.id),
    campaignAddress: String(item.campaign_address),
    campaignTweetId: String(item.campaign_tweet_id),
    tweetId: String(item.interaction_tweet_id),
    tweetUrl: item.interaction_url,
    type: item.interaction_type,
    userId: String(item.user_id),
    username: item.username || null,
    name: item.name || null,
    profileImageUrl: item.profile_image_url || null,
    text: item.text || "",
    createdAt: item.interaction_created_at || null,
    metrics: {
      likes: metric(item.likes),
      replies: metric(item.replies),
      retweets: metric(item.retweets),
      quotes: metric(item.quotes),
      views: metric(item.views),
    },
    status: item.status,
    verifiedAt: item.verified_at || null,
    lastRefreshedAt: item.last_refreshed_at || null,
    lastError: item.last_error || null,
    submittedAt: item.submitted_at || null,
    counted: scoreDetail ? Boolean(scoreDetail.counted) : false,
    score: scoreDetail ? Number(scoreDetail.score || 0) : null,
    reason: scoreDetail?.reason || null,
  };
}

async function findCampaign(address, tweetId, transaction = null) {
  const campaign = await E2eList.findByPk(String(address || "").trim(), { transaction });
  if (!campaign || String(campaign.tweet_id) !== String(tweetId)) {
    throw interactionError("E2E_CAMPAIGN_NOT_FOUND", 404, "互动任务不存在");
  }
  return campaign;
}

async function submitE2eInteraction({ address, campaignTweetId, tweetUrl, twitterUserId } = {}) {
  const userId = String(twitterUserId || "").trim();
  if (!userId) {
    throw interactionError("E2E_TWITTER_REQUIRED", 401, "请先连接 X 账号");
  }
  const parsed = parseInteractionTweetUrl(tweetUrl);
  const campaign = await findCampaign(address, campaignTweetId);
  const endTime = campaign.end_time ? new Date(campaign.end_time) : null;
  if (String(campaign.status) !== "active" || !endTime || Date.now() >= endTime.getTime()) {
    throw interactionError("E2E_INTERACTION_SUBMISSION_CLOSED", 409, "当前任务已停止提交互动");
  }
  const signup = await E2eRecord.findOne({
    where: { address: String(campaign.address), user_id: userId },
  });
  if (!signup) {
    throw interactionError("E2E_REGISTRATION_REQUIRED", 403, "请先报名该任务再提交互动");
  }

  const detail = await fetchInteractionTweet(parsed.tweetId);
  if (detail.authorId !== userId) {
    throw interactionError("E2E_INTERACTION_AUTHOR_MISMATCH", 403, "该链接不是当前登录 X 账号发布的内容");
  }
  const interactionType = resolveInteractionType(detail, campaign.tweet_id);
  if (detail.createdAt.getTime() > endTime.getTime()) {
    throw interactionError("E2E_INTERACTION_AFTER_CAMPAIGN", 400, "活动结束后的互动不能提交");
  }
  if (campaign.retro === false && signup.create_time && detail.createdAt.getTime() < new Date(signup.create_time).getTime()) {
    throw interactionError("E2E_INTERACTION_BEFORE_REGISTRATION", 400, "该任务仅统计报名后发布的互动");
  }

  try {
    return await pgInstance.transaction(async (transaction) => {
      await E2eRecord.findOne({
        where: { address: String(campaign.address), user_id: userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const existing = await E2eInteractionSubmission.findOne({
        where: {
          campaign_address: String(campaign.address),
          interaction_tweet_id: detail.tweetId,
        },
        transaction,
      });
      if (existing) {
        if (String(existing.user_id) !== userId) {
          throw interactionError("E2E_INTERACTION_ALREADY_CLAIMED", 409, "该互动已被其他用户提交");
        }
        return serializeInteractionSubmission(existing);
      }

      const scoringConfig = normalizeScoringConfig(campaign.score_config);
      const limit = interactionType === "reply" ? scoringConfig.maxReplies : scoringConfig.maxQuotes;
      const submittedCount = await E2eInteractionSubmission.count({
        where: {
          campaign_address: String(campaign.address),
          user_id: userId,
          interaction_type: interactionType,
        },
        transaction,
      });
      if (submittedCount >= limit) {
        throw interactionError(
          "E2E_INTERACTION_LIMIT_REACHED",
          409,
          `每位用户最多提交 ${limit} 条${interactionType === "reply" ? "评论" : "引用"}`
        );
      }

      const now = new Date();
      const created = await E2eInteractionSubmission.create({
        campaign_address: String(campaign.address),
        campaign_tweet_id: String(campaign.tweet_id),
        interaction_tweet_id: detail.tweetId,
        interaction_type: interactionType,
        interaction_url: detail.permanentUrl || `https://x.com/${detail.username || parsed.handle || "i/web"}/status/${detail.tweetId}`,
        user_id: userId,
        username: detail.username,
        name: detail.name,
        profile_image_url: detail.profileImageUrl,
        text: detail.text,
        interaction_created_at: detail.createdAt,
        ...detail.metrics,
        status: "verified",
        verified_at: now,
        last_refreshed_at: now,
        last_error: null,
        submitted_at: now,
        updated_at: now,
      }, { transaction });
      return serializeInteractionSubmission(created);
    });
  } catch (error) {
    if (error?.name !== "SequelizeUniqueConstraintError") throw error;
    const existing = await E2eInteractionSubmission.findOne({
      where: {
        campaign_address: String(campaign.address),
        interaction_tweet_id: detail.tweetId,
      },
    });
    if (existing && String(existing.user_id) === userId) return serializeInteractionSubmission(existing);
    throw interactionError("E2E_INTERACTION_ALREADY_CLAIMED", 409, "该互动已被其他用户提交");
  }
}

async function getMyE2eInteractions({ address, campaignTweetId, twitterUserId } = {}) {
  const userId = String(twitterUserId || "").trim();
  if (!userId) throw interactionError("E2E_TWITTER_REQUIRED", 401, "请先连接 X 账号");
  const campaign = await findCampaign(address, campaignTweetId);
  const [submissions, signup] = await Promise.all([
    E2eInteractionSubmission.findAll({
      where: { campaign_address: String(campaign.address), user_id: userId },
      order: [["interaction_created_at", "ASC"], ["interaction_tweet_id", "ASC"]],
    }),
    E2eRecord.findOne({ where: { address: String(campaign.address), user_id: userId } }),
  ]);
  const scoreDetails = Array.isArray(signup?.score_breakdown?.interactions)
    ? signup.score_breakdown.interactions
    : [];
  const scoreById = new Map(scoreDetails.map((item) => [String(item.id), item]));
  return submissions.map((item) => serializeInteractionSubmission(
    item,
    scoreById.get(String(item.interaction_tweet_id)) || null
  ));
}

async function refreshOneSubmission(submission) {
  try {
    const detail = await fetchInteractionTweet(submission.interaction_tweet_id);
    if (detail.authorId !== String(submission.user_id)) {
      throw interactionError("E2E_INTERACTION_AUTHOR_MISMATCH", 409, "互动作者与已验证用户不一致");
    }
    const type = resolveInteractionType(detail, submission.campaign_tweet_id);
    if (type !== submission.interaction_type) {
      throw interactionError("E2E_INTERACTION_TYPE_CHANGED", 409, "互动类型与首次验证结果不一致");
    }
    await submission.update({
      interaction_url: detail.permanentUrl || submission.interaction_url,
      username: detail.username || submission.username,
      name: detail.name || submission.name,
      profile_image_url: detail.profileImageUrl || submission.profile_image_url,
      text: detail.text,
      interaction_created_at: detail.createdAt,
      ...detail.metrics,
      last_refreshed_at: new Date(),
      last_error: null,
      updated_at: new Date(),
    });
    return { refreshed: true, failed: false };
  } catch (error) {
    await submission.update({
      last_error: `${error.code || "E2E_INTERACTION_REFRESH_FAILED"}: ${error.message || "刷新失败"}`,
      updated_at: new Date(),
    }).catch(() => {});
    return { refreshed: false, failed: true };
  }
}

async function refreshCampaignInteractionSubmissions(campaignOrAddress) {
  const address = typeof campaignOrAddress === "string"
    ? campaignOrAddress
    : String(campaignOrAddress?.address || "");
  const submissions = await E2eInteractionSubmission.findAll({
    where: { campaign_address: address, status: "verified" },
    order: [["interaction_created_at", "ASC"]],
  });
  const results = [];
  for (let index = 0; index < submissions.length; index += REFRESH_BATCH_SIZE) {
    const batch = submissions.slice(index, index + REFRESH_BATCH_SIZE);
    results.push(...await Promise.all(batch.map(refreshOneSubmission)));
  }
  return {
    total: submissions.length,
    refreshed: results.filter((item) => item.refreshed).length,
    failed: results.filter((item) => item.failed).length,
  };
}

async function listCampaignInteractionSubmissions(address) {
  return E2eInteractionSubmission.findAll({
    where: { campaign_address: String(address), status: { [Op.in]: ["verified", "unavailable"] } },
    order: [["interaction_created_at", "ASC"], ["interaction_tweet_id", "ASC"]],
  });
}

function toScoringInteraction(record) {
  const item = record?.toJSON ? record.toJSON() : record;
  return {
    id: String(item.interaction_tweet_id),
    user_id: String(item.user_id),
    username: item.username || null,
    profile_image_url: item.profile_image_url || null,
    text: item.text || "",
    create_time: item.interaction_created_at,
    likes: metric(item.likes),
    replies: metric(item.replies),
    retweets: metric(item.retweets),
    quotes: metric(item.quotes),
    views: metric(item.views),
  };
}

module.exports = {
  fetchInteractionTweet,
  getMyE2eInteractions,
  listCampaignInteractionSubmissions,
  parseInteractionTweetUrl,
  refreshCampaignInteractionSubmissions,
  serializeInteractionSubmission,
  submitE2eInteraction,
  toScoringInteraction,
};
