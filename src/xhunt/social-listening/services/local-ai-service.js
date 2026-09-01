const { structuredChat } = require("../../../lib/llm");
const {
  STRICT_DOMAIN_TAG_VERSION,
  STRICT_DOMAIN_TAGS,
  STRICT_CRYPTO_SUB_TAGS,
  STRICT_AI_SUB_TAGS,
} = require("./ai-prompt-templates");

const TWEET_TAG_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    crypto_relevant: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
    summary_cn: { type: "string" },
    summary_en: { type: "string" },
    domain_tag: { type: "string", enum: STRICT_DOMAIN_TAGS },
    domain_tag_version: { type: "string", enum: [STRICT_DOMAIN_TAG_VERSION] },
    crypto_sub_tags: { type: "array", items: { type: "string", enum: STRICT_CRYPTO_SUB_TAGS } },
    ai_sub_tags: { type: "array", items: { type: "string", enum: STRICT_AI_SUB_TAGS } },
    hot_tags: { type: "array", items: { type: "string" } },
  },
  required: ["crypto_relevant", "tags", "domain_tag", "domain_tag_version", "crypto_sub_tags", "ai_sub_tags", "hot_tags"],
});

const PROJECT_ATTITUDE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    score: { type: "number" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "unknown"] },
    relevant_to_project: { type: "boolean" },
    confidence: { type: "number" },
    summary: { type: "string" },
  },
  required: ["score", "sentiment", "relevant_to_project", "confidence", "summary"],
});

const TWEET_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string" },
    post_zh: { type: "string" },
  },
  required: ["summary"],
});

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function getLlmOptions(aiConfig = {}, purpose) {
  const apiKey = getText(aiConfig.apiKey);
  if (!apiKey) {
    throw new Error("SOCIAL_LISTENING_LLM_API_KEY_NOT_CONFIGURED");
  }

  const model = getText(aiConfig[`${purpose}Model`], getText(aiConfig.model, "gemini-3.1-flash-lite-preview"));
  const maxTokens = toNumber(aiConfig[`${purpose}MaxTokens`], toNumber(aiConfig.maxTokens, 1200));
  return {
    model,
    temperature: toNumber(aiConfig.temperature, 0),
    maxTokens,
    apiKey,
    baseURL: getText(aiConfig.baseURL, "https://aaii.xclaw.info/v1/"),
    timeout: toNumber(aiConfig.timeoutMs, 120000),
    maxRetries: toNumber(aiConfig.maxRetries, 2),
    systemPrompt: getText(aiConfig.systemPrompt, "你是严格的 JSON 结构化分析助手。只输出符合 Schema 的 JSON。"),
  };
}

async function generateTweetTagV2({ prompt, aiConfig }) {
  return structuredChat(prompt, TWEET_TAG_SCHEMA, getLlmOptions(aiConfig, "tweetTag"));
}

async function generateProjectAttitude({ prompt, aiConfig }) {
  const data = await structuredChat(prompt, PROJECT_ATTITUDE_SCHEMA, getLlmOptions(aiConfig, "projectAttitude"));
  const score = Math.max(0, Math.min(10, toNumber(data.score, 5)));
  const rawConfidence = Number(data.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : null;
  return {
    ...data,
    score,
    confidence,
  };
}

async function generateTweetSummaryMedia({ prompt, aiConfig }) {
  return structuredChat(prompt, TWEET_SUMMARY_SCHEMA, getLlmOptions(aiConfig, "tweetSummary"));
}

module.exports = {
  generateTweetTagV2,
  generateProjectAttitude,
  generateTweetSummaryMedia,
};
