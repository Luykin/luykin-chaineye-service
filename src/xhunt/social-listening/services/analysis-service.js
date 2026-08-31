const axios = require("axios");
const { Op } = require("sequelize");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");
const { SENTIMENTS } = require("../constants");
const { normalizeTweetText } = require("../utils/text-normalize");

const DEFAULT_AI_BASE_URL = "http://backend-v1.xhunt.svc.cluster.local:3010";
const DEFAULT_TIMEOUT_MS = Number(process.env.SOCIAL_LISTENING_AI_TIMEOUT_MS || 8000);
const SUMMARY_WORDS = Number(process.env.SOCIAL_LISTENING_SUMMARY_WORDS || 5);
const NEGATIVE_THRESHOLD = Number(process.env.SOCIAL_LISTENING_NEGATIVE_SCORE_THRESHOLD || 4);
const POSITIVE_THRESHOLD = Number(process.env.SOCIAL_LISTENING_POSITIVE_SCORE_THRESHOLD || 6);

function getAiBaseUrl() {
  return String(process.env.SOCIAL_LISTENING_AI_BASE_URL || process.env.AI_SERVICE_BASE_URL || DEFAULT_AI_BASE_URL).replace(/\/+$/, "");
}

function isProjectAttitudeEnabled() {
  if (process.env.SOCIAL_LISTENING_PROJECT_ATTITUDE_ENABLED === "false") return false;
  return Boolean(getAiBaseUrl());
}

function isContentAiEnabled() {
  if (process.env.SOCIAL_LISTENING_CONTENT_AI_ENABLED === "false") return false;
  return Boolean(getAiBaseUrl());
}

function scoreToSentiment(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) return SENTIMENTS.UNKNOWN;
  if (num < NEGATIVE_THRESHOLD) return SENTIMENTS.NEGATIVE;
  if (num > POSITIVE_THRESHOLD) return SENTIMENTS.POSITIVE;
  return SENTIMENTS.NEUTRAL;
}

async function callAiEndpoint(path, payload) {
  const baseUrl = getAiBaseUrl();
  if (!baseUrl) throw new Error("SOCIAL_LISTENING_AI_NOT_CONFIGURED");
  const headers = { "Content-Type": "application/json" };
  if (process.env.SOCIAL_LISTENING_AI_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SOCIAL_LISTENING_AI_TOKEN}`;
  }
  const response = await axios.post(`${baseUrl}${path}`, payload, { timeout: DEFAULT_TIMEOUT_MS, headers });
  return response?.data?.data || response?.data || {};
}

function buildProjectPromptName(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  return String(metadata.aiProjectName || board.projectName || board.officialHandle || "").trim();
}

async function callProjectAttitudeAi(board, post) {
  const text = `<<${new Date(post.postCreatedAt).toISOString()}--${normalizeTweetText(post.text || post.normalizedText || "")}>>`;
  const data = await callAiEndpoint("/ai/project_attitude", {
    text,
    project: buildProjectPromptName(board),
    lang: "cn",
  });

  const score = data.score ?? data.data?.score;
  return {
    score,
    sentiment: scoreToSentiment(score),
    summary: data.summary || data.reason || data.message || null,
    raw: data,
  };
}

function normalizeList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function mergeListValues(...values) {
  return Array.from(new Set(values.flatMap(normalizeList)));
}

function extractTagResult(data = {}) {
  const source = data.data && typeof data.data === "object" ? data.data : data;
  const topics = mergeListValues(
    source.domain_tag,
    source.domain_tags,
    source.crypto_sub_tags,
    source.ai_sub_tags,
    source.tags,
    source.topics
  );
  const keywords = mergeListValues(source.hot_tags, source.keywords);
  return { topics, keywords, raw: source };
}

function extractSummaryResult(data = {}) {
  const source = data.data && typeof data.data === "object" ? data.data : data;
  return {
    summaryZh: source.summary_cn || source.summaryZh || source.summary || null,
    summaryEn: source.summary_en || source.summaryEn || null,
    titleZh: source.title_cn || source.titleZh || null,
    titleEn: source.title_en || source.titleEn || null,
    abstractZh: source.abstract_cn || source.abstractZh || null,
    abstractEn: source.abstract_en || source.abstractEn || null,
    raw: source,
  };
}

function hasSummaryFields(row) {
  return Boolean(row.summaryZh || row.summaryEn || row.titleZh || row.titleEn || row.abstractZh || row.abstractEn);
}

async function callTweetTagAi(post) {
  const text = normalizeTweetText(post.text || post.normalizedText || "");
  if (!text) return { topics: [], keywords: [], raw: {} };
  const data = await callAiEndpoint("/ai/tweet_tag_v2", { text });
  return extractTagResult(data);
}

function pickFirstMedia(post) {
  const info = post.rawTweet?.info && typeof post.rawTweet.info === "object" ? post.rawTweet.info : {};
  const videos = Array.isArray(info.videos) ? info.videos : [];
  const photos = Array.isArray(info.photos) ? info.photos : [];
  const video = videos[0];
  if (video) return String(video.url || video.video_url || video.media_url || "");
  const photo = photos[0];
  if (photo) return String(photo.url || photo.media_url || "");
  return "";
}

async function callTweetSummaryAi(post, lang) {
  const text = normalizeTweetText(post.text || post.normalizedText || "");
  if (!text) return "";
  const data = await callAiEndpoint("/ai/tweet_summary_media", {
    text,
    lang,
    words: SUMMARY_WORDS,
    media: pickFirstMedia(post),
  });
  if (typeof data === "string") return data;
  return data.summary || data.text || "";
}

async function analyzePendingContentMetadata(board, options = {}) {
  if (!isContentAiEnabled()) return { enabled: false, analyzed: 0, failed: 0, skipped: 0 };
  const limit = Math.min(Math.max(Number(options.limit || process.env.SOCIAL_LISTENING_CONTENT_AI_BATCH_SIZE || 10), 1), 50);
  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      text: { [Op.ne]: null },
      [Op.or]: [
        { tagStatus: null },
        { tagStatus: { [Op.in]: ["pending", "failed", "reused"] } },
        { summaryStatus: null },
        { summaryStatus: { [Op.in]: ["pending", "failed", "reused"] } },
        { aiSource: "dev_tweet_ai" },
      ],
    },
    order: [
      ["authorGlobalRank", "ASC"],
      ["viewsCount", "DESC"],
      ["postCreatedAt", "DESC"],
    ],
    limit,
  });

  let analyzed = 0;
  let failed = 0;
  let skipped = 0;
  for (const post of posts) {
    const text = normalizeTweetText(post.text || post.normalizedText || "");
    if (!text || text.length < 8) {
      skipped += 1;
      await post.update({
        tagStatus: post.tagStatus === "pending" || !post.tagStatus ? "skipped" : post.tagStatus,
        summaryStatus: post.summaryStatus === "pending" || !post.summaryStatus ? "skipped" : post.summaryStatus,
        aiStatus: "skipped",
      }).catch(() => null);
      continue;
    }

    try {
      const patch = {};
      const rawAi = { ...(post.rawTweet?.socialListeningAi || {}) };
      const shouldGenerateTag = !Array.isArray(post.topics) || !post.topics.length || ["pending", "failed", "reused"].includes(post.tagStatus || "");
      const shouldGenerateSummary = !hasSummaryFields(post) || ["pending", "failed", "reused"].includes(post.summaryStatus || "") || post.aiSource === "dev_tweet_ai";
      const shouldReplaceOldAiFields = post.aiSource === "dev_tweet_ai" || post.tagStatus === "reused" || post.summaryStatus === "reused";

      if (shouldGenerateTag) {
        const tagResult = await callTweetTagAi(post);
        const matchedKeywords = Array.isArray(post.rawTweet?.matchedKeywords) ? post.rawTweet.matchedKeywords : [];
        if (shouldReplaceOldAiFields) patch.topics = tagResult.topics.length ? tagResult.topics : null;
        else if (tagResult.topics.length) patch.topics = mergeListValues(post.topics, tagResult.topics);
        if (shouldReplaceOldAiFields) patch.keywords = mergeListValues(matchedKeywords, tagResult.keywords);
        else if (tagResult.keywords.length) patch.keywords = mergeListValues(post.keywords, tagResult.keywords);
        patch.tagStatus = tagResult.topics.length || tagResult.keywords.length ? "generated" : "skipped";
        rawAi.tag = tagResult.raw;
      }
      if (shouldGenerateSummary) {
        const [summaryZh, summaryEn] = await Promise.all([
          shouldGenerateSummary ? callTweetSummaryAi(post, "chinese") : Promise.resolve(post.summaryZh),
          shouldGenerateSummary ? callTweetSummaryAi(post, "english") : Promise.resolve(post.summaryEn),
        ]);
        if (summaryZh || shouldReplaceOldAiFields) patch.summaryZh = summaryZh || null;
        if (summaryEn || shouldReplaceOldAiFields) patch.summaryEn = summaryEn || null;
        patch.summaryStatus = summaryZh || summaryEn ? "generated" : "skipped";
        rawAi.summary = { summaryZh, summaryEn };
      }

      if (Object.keys(patch).length) {
        await post.update({
          ...patch,
          aiStatus: post.attitudeStatus === "succeeded" ? "succeeded" : "partial",
          aiAnalyzedAt: new Date(),
          aiError: null,
          aiSource: "social_listening_generated",
          rawTweet: {
            ...(post.rawTweet || {}),
            socialListeningAi: rawAi,
          },
        });
        analyzed += 1;
      }
    } catch (error) {
      failed += 1;
      await post.update({
        tagStatus: ["pending", "failed", null].includes(post.tagStatus) ? "failed" : post.tagStatus,
        summaryStatus: ["pending", "failed", null].includes(post.summaryStatus) ? "failed" : post.summaryStatus,
        aiAnalyzedAt: new Date(),
        aiError: String(error.message || error).slice(0, 1000),
      }).catch(() => null);
    }
  }

  return { enabled: true, analyzed, failed, skipped };
}

async function analyzePendingProjectAttitudes(board, options = {}) {
  if (!isProjectAttitudeEnabled()) return { enabled: false, analyzed: 0, failed: 0 };
  const limit = Math.min(Math.max(Number(options.limit || process.env.SOCIAL_LISTENING_AI_BATCH_SIZE || 20), 1), 100);
  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      [Op.or]: [
        { attitudeStatus: null },
        { attitudeStatus: { [Op.in]: ["pending", "failed"] } },
      ],
      text: { [Op.ne]: null },
    },
    order: [
      ["authorGlobalRank", "ASC"],
      ["viewsCount", "DESC"],
      ["postCreatedAt", "DESC"],
    ],
    limit,
  });

  let analyzed = 0;
  let failed = 0;
  for (const post of posts) {
    try {
      const result = await callProjectAttitudeAi(board, post);
      await post.update({
        projectAttitudeScore: result.score,
        sentimentScore: result.score,
        sentiment: result.sentiment,
        sentimentSummaryZh: result.summary,
        attitudeStatus: "succeeded",
        aiStatus: post.tagStatus === "pending" || post.summaryStatus === "pending" ? "partial" : "succeeded",
        aiAnalyzedAt: new Date(),
        aiError: null,
        aiSource: post.aiSource && post.aiSource !== "social_listening_pending" ? "mixed" : "project_attitude",
        rawTweet: {
          ...(post.rawTweet || {}),
          projectAttitude: { score: result.score, sentiment: result.sentiment },
        },
      });
      analyzed += 1;
    } catch (error) {
      failed += 1;
      await post.update({
        sentiment: SENTIMENTS.UNKNOWN,
        attitudeStatus: "failed",
        aiAnalyzedAt: new Date(),
        aiError: String(error.message || error).slice(0, 1000),
      }).catch(() => null);
    }
  }
  return { enabled: true, analyzed, failed };
}

module.exports = {
  isContentAiEnabled,
  isProjectAttitudeEnabled,
  scoreToSentiment,
  callProjectAttitudeAi,
  analyzePendingContentMetadata,
  analyzePendingProjectAttitudes,
};
