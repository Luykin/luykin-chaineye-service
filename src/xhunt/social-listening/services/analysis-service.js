const axios = require("axios");
const { Op } = require("sequelize");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");
const { SENTIMENTS } = require("../constants");
const { normalizeTweetText } = require("../utils/text-normalize");

const DEFAULT_TIMEOUT_MS = Number(process.env.SOCIAL_LISTENING_AI_TIMEOUT_MS || 8000);
const NEGATIVE_THRESHOLD = Number(process.env.SOCIAL_LISTENING_NEGATIVE_SCORE_THRESHOLD || 4);
const POSITIVE_THRESHOLD = Number(process.env.SOCIAL_LISTENING_POSITIVE_SCORE_THRESHOLD || 6);

function getAiBaseUrl() {
  return String(process.env.SOCIAL_LISTENING_AI_BASE_URL || process.env.AI_SERVICE_BASE_URL || "").replace(/\/+$/, "");
}

function isProjectAttitudeEnabled() {
  if (process.env.SOCIAL_LISTENING_PROJECT_ATTITUDE_ENABLED === "false") return false;
  return Boolean(getAiBaseUrl());
}

function scoreToSentiment(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) return SENTIMENTS.UNKNOWN;
  if (num < NEGATIVE_THRESHOLD) return SENTIMENTS.NEGATIVE;
  if (num > POSITIVE_THRESHOLD) return SENTIMENTS.POSITIVE;
  return SENTIMENTS.NEUTRAL;
}

function buildProjectPromptName(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  const aliases = Array.isArray(metadata.aliases) ? metadata.aliases : [];
  const token = metadata.token ? [metadata.token] : [];
  return [board.projectName, `@${board.officialHandle}`, ...aliases, ...token]
    .filter(Boolean)
    .map(String)
    .join(" / ");
}

async function callProjectAttitudeAi(board, post) {
  const baseUrl = getAiBaseUrl();
  if (!baseUrl) throw new Error("SOCIAL_LISTENING_AI_NOT_CONFIGURED");
  const endpoint = `${baseUrl}/ai/project_attitude`;
  const text = `<<${new Date(post.postCreatedAt).toISOString()}--${normalizeTweetText(post.text || post.normalizedText || "")}>>`;
  const headers = {};
  if (process.env.SOCIAL_LISTENING_AI_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SOCIAL_LISTENING_AI_TOKEN}`;
  }

  const response = await axios.post(endpoint, {
    text,
    project: buildProjectPromptName(board),
    lang: process.env.SOCIAL_LISTENING_AI_LANG || "zh",
  }, { timeout: DEFAULT_TIMEOUT_MS, headers });

  const data = response?.data?.data || response?.data || {};
  const score = data.score ?? data.data?.score;
  return {
    score,
    sentiment: scoreToSentiment(score),
    summary: data.summary || data.reason || data.message || null,
    raw: data,
  };
}

async function analyzePendingProjectAttitudes(board, options = {}) {
  if (!isProjectAttitudeEnabled()) return { enabled: false, analyzed: 0, failed: 0 };
  const limit = Math.min(Math.max(Number(options.limit || process.env.SOCIAL_LISTENING_AI_BATCH_SIZE || 20), 1), 100);
  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      attitudeStatus: { [Op.in]: [null, "pending", "failed"] },
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
  isProjectAttitudeEnabled,
  scoreToSentiment,
  callProjectAttitudeAi,
  analyzePendingProjectAttitudes,
};
