const axios = require("axios");
const { QueryTypes } = require("sequelize");
const { E2eTweet } = require("../../../models/postgres-start");
const { structuredChat } = require("../../../lib/llm");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../../infra/k8s/postgres-readonly");
const { getEchohuntTweetDetail } = require("../../../xhunt/services/twitter-echohunt");

const EXAMINE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary_cn: { type: "string" },
    summary_en: { type: "string" },
    political: { type: "boolean" },
    sexual: { type: "boolean" },
    violence: { type: "boolean" },
    abusive: { type: "boolean" },
    passed: { type: "boolean" },
    explanation: { type: "string" },
  },
  required: [
    "summary_cn",
    "summary_en",
    "political",
    "sexual",
    "violence",
    "abusive",
    "passed",
    "explanation",
  ],
});

/**
 * 从推文链接或输入字符串中提取 tweet_id
 * 支持：
 * - 纯数字 tweet_id
 * - https://x.com/<handle>/status/<id>
 * - https://twitter.com/<handle>/status/<id>
 * - https://x.com/i/article/<id>
 */
function parseTweetInput(rawInput) {
  const text = String(rawInput || "").trim();
  if (!text) return { tweetId: null, handle: null };
  if (/^\d{8,25}$/.test(text)) {
    return { tweetId: text, handle: null };
  }
  const statusMatch = text.match(
    /(?:x\.com|twitter\.com)\/(?:([A-Za-z0-9_]{1,30})\/status|i\/web\/status|i\/article)\/(\d{8,25})/i
  );
  if (statusMatch) {
    return {
      handle: statusMatch[1] || null,
      tweetId: statusMatch[2],
    };
  }
  const fallbackDigits = text.match(/\/(\d{10,25})(?:[/?#]|$)/);
  if (fallbackDigits) {
    return { tweetId: fallbackDigits[1], handle: null };
  }
  return { tweetId: null, handle: null };
}

function getCrawlerUrl() {
  const fullUrl = String(process.env.SOCIAL_LISTENING_CRAWLER_URL || process.env.TWITTER_CLIENT_URL || "").trim();
  if (fullUrl) return fullUrl;
  const baseUrl = String(
    process.env.SOCIAL_LISTENING_CRAWLER_BASE_URL ||
      process.env.CRYPTOHUNT_CRAWLER_BASE_URL ||
      process.env.CRAWLER_TWITTER_BASE_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/crawler` : "";
}

async function fetchTweetFromReadonlyDb(tweetId) {
  try {
    const status = getPostgresReadOnlyStatus();
    if (!isPostgresReadOnlyConfigured() || !status.ready) return null;
    const db = getPostgresReadOnlyInstance();
    const [row] = await db.query(
      `
        SELECT
          t.id::text AS tweet_id,
          t.text,
          t.twitter_user_id::text AS owner_user_id,
          u.username AS owner_handle,
          u.name AS owner_name,
          u.profile AS owner_profile
        FROM dev.tweet t
        LEFT JOIN dev.twitter_user u ON u.id::text = t.twitter_user_id::text
        WHERE t.id::text = :tweetId
        LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { tweetId: String(tweetId) },
      }
    );
    if (!row) return null;
    const profile = row.owner_profile && typeof row.owner_profile === "object" ? row.owner_profile : {};
    return {
      tweet_id: String(row.tweet_id),
      text: row.text || "",
      html: null,
      owner_user_id: row.owner_user_id ? String(row.owner_user_id) : null,
      owner_handle: row.owner_handle || profile.username || null,
      owner_name: row.owner_name || profile.name || null,
      owner_image_url:
        profile.profile_image_url ||
        profile.profile_image_url_https ||
        profile.avatar ||
        null,
    };
  } catch (_) {
    return null;
  }
}

async function fetchTweetFromCrawler(tweetId) {
  const crawlerUrl = getCrawlerUrl();
  if (!crawlerUrl) return null;
  try {
    const response = await axios.post(
      crawlerUrl,
      {
        endpoint: "tweet_detail",
        tweet_id: String(tweetId),
      },
      {
        timeout: 18000,
        headers: { "Content-Type": "application/json" },
      }
    );
    const body = response.data || {};
    const data = body.data || body;
    const tweet = data?.tweet || (Array.isArray(data?.tweets) ? data.tweets[0] : data);
    if (!tweet || (!tweet.text && !tweet.html)) return null;
    const profile = tweet.user_profile && typeof tweet.user_profile === "object" ? tweet.user_profile : {};
    return {
      tweet_id: String(tweet.id || tweetId),
      text: tweet.text || "",
      html: tweet.html || null,
      owner_user_id: String(profile.id || tweet.user_id || ""),
      owner_handle: profile.username || tweet.username || null,
      owner_name: profile.name || tweet.name || null,
      owner_image_url: profile.profile_image_url || null,
    };
  } catch (_) {
    return null;
  }
}

async function runAiTweetExamine(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return {
      summary_cn: "",
      summary_en: "",
      political: false,
      sexual: false,
      violence: false,
      abusive: false,
      passed: false,
      retryable: true,
      explanation: "Tweet content is unavailable",
    };
  }
  if (!process.env.LLM_API_KEY) {
    return {
      summary_cn: "",
      summary_en: "",
      political: false,
      sexual: false,
      violence: false,
      abusive: false,
      passed: false,
      retryable: true,
      explanation: "LLM_API_KEY is not configured",
    };
  }

  try {
    const prompt = [
      "你是一个推文合规审核与摘要助手。请对以下推文进行审核并生成中英文简明摘要：",
      "1. 判断是否包含敏感政治(political)、色情(sexual)、暴力(violence)、辱骂攻击(abusive)内容；",
      "2. 如果四项均为 false，则 passed 为 true，否则 passed 为 false；",
      "3. 生成 1~2 句话的中文摘要(summary_cn)和英文摘要(summary_en)。",
      "",
      `推文内容：\n${cleanText.slice(0, 4000)}`,
    ].join("\n");

    const result = await structuredChat(prompt, EXAMINE_SCHEMA, {
      temperature: 0.1,
    });
    const hasViolation = Boolean(
      result?.political || result?.sexual || result?.violence || result?.abusive
    );
    return {
      summary_cn: String(result?.summary_cn || cleanText.slice(0, 180)),
      summary_en: String(result?.summary_en || cleanText.slice(0, 180)),
      political: Boolean(result?.political),
      sexual: Boolean(result?.sexual),
      violence: Boolean(result?.violence),
      abusive: Boolean(result?.abusive),
      passed: !hasViolation && result?.passed === true,
      retryable: false,
      explanation: String(result?.explanation || (hasViolation ? "Content policy violation" : "Passed")),
    };
  } catch (error) {
    return {
      summary_cn: "",
      summary_en: "",
      political: false,
      sexual: false,
      violence: false,
      abusive: false,
      passed: false,
      retryable: true,
      explanation: `AI review failed: ${error.message || "LLM error"}`,
    };
  }
}

/**
 * 校验并解析目标推文（支持传 tweet_id 或完整推文链接 tweet_url）
 */
async function examineE2eTweet({ tweet_id, tweet_url, identity, fallbackOwner } = {}) {
  const parsed = parseTweetInput(tweet_url || tweet_id);
  const tweetId = parsed.tweetId;
  if (!tweetId) {
    return {
      status: false,
      message: "无效的推文链接或推文 ID，请输入形如 https://x.com/username/status/123456 的链接",
    };
  }

  const existing = await E2eTweet.findByPk(String(tweetId));
  if (existing && existing.text && existing.passed !== null) {
    return {
      status: Boolean(existing.passed),
      message: existing.passed ? "ok" : existing.explanation || "该推文未通过合规审核",
      data: existing.toJSON(),
    };
  }

  let rawTweet =
    (await fetchTweetFromReadonlyDb(tweetId)) ||
    (await fetchTweetFromCrawler(tweetId));

  if (!rawTweet && identity) {
    try {
      const detail = await getEchohuntTweetDetail(identity, tweetId);
      if (detail?.text) {
        rawTweet = {
          tweet_id: String(tweetId),
          text: detail.text,
          html: null,
          owner_user_id: detail.authorId || fallbackOwner?.twitterId || null,
          owner_handle: parsed.handle || fallbackOwner?.username || null,
          owner_image_url: fallbackOwner?.avatar || null,
        };
      }
    } catch (_) {
      // ignore X API fallback error
    }
  }

  if (!rawTweet) {
    if (!existing?.text) {
      return { status: false, message: "无法获取目标推文，请确认推文存在且可访问后重试" };
    }
    rawTweet = {
      tweet_id: String(tweetId),
      text: existing.text,
      html: existing.html || null,
      owner_user_id: existing.owner_user_id || null,
      owner_handle: existing.owner_handle || parsed.handle || null,
      owner_image_url: existing.owner_image_url || null,
    };
  }

  const aiExamine = await runAiTweetExamine(rawTweet.text);
  if (aiExamine.retryable) {
    return { status: false, message: aiExamine.explanation || "推文审核暂时不可用，请稍后重试" };
  }

  const payload = {
    tweet_id: String(tweetId),
    text: rawTweet.text || existing?.text || "",
    html: rawTweet.html || existing?.html || null,
    summary_cn: aiExamine.summary_cn || existing?.summary_cn || "",
    summary_en: aiExamine.summary_en || existing?.summary_en || "",
    owner_handle: rawTweet.owner_handle || existing?.owner_handle || parsed.handle || null,
    owner_image_url: rawTweet.owner_image_url || existing?.owner_image_url || null,
    owner_user_id: String(rawTweet.owner_user_id || existing?.owner_user_id || fallbackOwner?.twitterId || tweetId),
    political: aiExamine.political,
    sexual: aiExamine.sexual,
    violence: aiExamine.violence,
    abusive: aiExamine.abusive,
    explanation: aiExamine.explanation,
    passed: aiExamine.passed,
  };

  await E2eTweet.upsert(payload);

  return {
    status: Boolean(payload.passed),
    message: payload.passed ? "ok" : payload.explanation || "该推文未通过合规审核",
    data: payload,
  };
}

module.exports = {
  parseTweetInput,
  examineE2eTweet,
};
