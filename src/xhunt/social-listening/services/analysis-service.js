const { Op } = require("sequelize");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");
const { SENTIMENTS } = require("../constants");
const { normalizeTweetText } = require("../utils/text-normalize");

const { getSocialListeningRuntimeConfig } = require("./runtime-config");
const { PROMPT_FIELDS, PROMPT_ALIASES, DEFAULT_LOCAL_AI_PROMPTS } = require("./ai-prompt-templates");
const {
  generateTweetTagV2,
  generateProjectAttitude,
  generateTweetSummaryMedia,
} = require("./local-ai-service");

async function getAiConfig() {
  const config = await getSocialListeningRuntimeConfig();
  return config.ai || {};
}

function hasLocalAiConfig(aiConfig = {}) {
  return Boolean(String(aiConfig.apiKey || "").trim() && String(aiConfig.baseURL || "").trim());
}

async function isProjectAttitudeEnabled() {
  const aiConfig = await getAiConfig();
  return Boolean(aiConfig.projectAttitudeEnabled && hasLocalAiConfig(aiConfig));
}

async function isContentAiEnabled() {
  const aiConfig = await getAiConfig();
  return Boolean(aiConfig.contentEnabled && hasLocalAiConfig(aiConfig));
}

function normalizePrompt(value, maxLength = 6000) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, Math.max(200, Number(maxLength) || 6000));
}

function getBoardMetadata(board) {
  return board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
}

function pickPromptValue(prompts, field) {
  const source = prompts && typeof prompts === "object" ? prompts : {};
  const keys = PROMPT_ALIASES[field] || [field];
  for (const key of keys) {
    if (source[key]) return source[key];
  }
  return "";
}

function getBoardPrompt(board, field, maxLength) {
  const metadata = getBoardMetadata(board);
  const prompts = metadata.aiPrompts && typeof metadata.aiPrompts === "object" ? metadata.aiPrompts : {};
  return normalizePrompt(pickPromptValue(prompts, field), maxLength);
}

function getRuntimePrompt(aiConfig, field) {
  return normalizePrompt(pickPromptValue(aiConfig?.prompts, field), aiConfig?.promptMaxLength);
}

function getDefaultPrompt(field) {
  return DEFAULT_LOCAL_AI_PROMPTS[field] || "";
}

function renderPromptTemplate(prompt, variables = {}) {
  return String(prompt || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function buildPromptInfo(board, aiConfig, field, variables = {}) {
  const boardTemplate = getBoardPrompt(board, field, aiConfig?.promptMaxLength);
  const runtimeTemplate = getRuntimePrompt(aiConfig, field);
  const defaultTemplate = getDefaultPrompt(field);
  let source = "default";
  let configured = false;
  let template = defaultTemplate;

  if (runtimeTemplate) {
    template = runtimeTemplate;
    source = "nacos.echohunt_social_listening_config.ai.prompts";
    configured = true;
  }
  if (boardTemplate) {
    template = boardTemplate;
    source = "board.metadata.aiPrompts";
    configured = true;
  }

  let prompt = renderPromptTemplate(template, variables);
  if (variables.text && !prompt.includes(String(variables.text))) {
    prompt = `${prompt}\n\n输入文本：\n${variables.text}`;
  }
  return {
    prompt,
    trace: {
      key: field,
      source,
      configured,
      length: prompt.length,
      preview: prompt.slice(0, 240),
      templatePreview: template.slice(0, 240),
    },
  };
}

function buildPromptTrace(board, field, variables = {}, aiConfig = {}) {
  return buildPromptInfo(board, aiConfig, field, variables).trace;
}

function hasPromptOverride(board, field) {
  return Boolean(getBoardPrompt(board, field));
}

function countPromptOverrides(board, fields) {
  return fields.filter((field) => hasPromptOverride(board, field)).length;
}

function scoreToSentiment(score, config = {}) {
  const num = Number(score);
  if (!Number.isFinite(num)) return SENTIMENTS.UNKNOWN;
  const negativeThreshold = Number.isFinite(Number(config.negativeScoreThreshold)) ? Number(config.negativeScoreThreshold) : 4;
  const positiveThreshold = Number.isFinite(Number(config.positiveScoreThreshold)) ? Number(config.positiveScoreThreshold) : 6;
  if (num < negativeThreshold) return SENTIMENTS.NEGATIVE;
  if (num > positiveThreshold) return SENTIMENTS.POSITIVE;
  return SENTIMENTS.NEUTRAL;
}

function buildProjectPromptName(board) {
  const metadata = getBoardMetadata(board);
  return String(metadata.aiProjectName || board.projectName || board.officialHandle || "").trim();
}

async function callProjectAttitudeAi(board, post) {
  const aiConfig = await getAiConfig();
  const text = `<<${new Date(post.postCreatedAt).toISOString()}--${normalizeTweetText(post.text || post.normalizedText || "")}>>`;
  const project = buildProjectPromptName(board);
  const promptVariables = { text, project, lang: "cn" };
  const { prompt, trace: promptTrace } = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.PROJECT_ATTITUDE, promptVariables);
  const data = await generateProjectAttitude({ prompt, aiConfig });

  const score = data.score ?? data.data?.score;
  return {
    score,
    sentiment: scoreToSentiment(score, aiConfig),
    summary: data.summary || data.reason || data.message || null,
    raw: data,
    promptTrace,
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

async function callTweetTagAi(board, post) {
  const text = normalizeTweetText(post.text || post.normalizedText || "");
  const promptVariables = { text };
  const aiConfig = await getAiConfig();
  const { prompt, trace: promptTrace } = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.TWEET_TAG, promptVariables);
  if (!text) return { topics: [], keywords: [], raw: {}, promptTrace };
  const data = await generateTweetTagV2({ prompt, aiConfig });
  return { ...extractTagResult(data), promptTrace };
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

async function callTweetSummaryAi(board, post, lang) {
  const aiConfig = await getAiConfig();
  const summaryWords = aiConfig.summaryWords || 5;
  const text = normalizeTweetText(post.text || post.normalizedText || "");
  const promptVariables = { text, lang, words: summaryWords, media: pickFirstMedia(post) };
  const { prompt, trace: promptTrace } = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.TWEET_SUMMARY, promptVariables);
  if (!text) return { summary: "", promptTrace, raw: {} };
  const data = await generateTweetSummaryMedia({ prompt, aiConfig });
  const summary = typeof data === "string" ? data : (data.summary || data.text || "");
  return { summary, promptTrace, raw: typeof data === "object" ? data : { text: data } };
}

async function analyzePendingContentMetadata(board, options = {}) {
  const aiConfig = await getAiConfig();
  if (!await isContentAiEnabled()) return { enabled: false, analyzed: 0, failed: 0, skipped: 0 };
  const limit = Math.min(Math.max(Number(options.limit || aiConfig.contentBatchSize || 10), 1), 50);
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
  const promptOverrides = countPromptOverrides(board, [PROMPT_FIELDS.TWEET_TAG, PROMPT_FIELDS.TWEET_SUMMARY]);
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
        const tagResult = await callTweetTagAi(board, post);
        const matchedKeywords = Array.isArray(post.rawTweet?.matchedKeywords) ? post.rawTweet.matchedKeywords : [];
        if (shouldReplaceOldAiFields) patch.topics = tagResult.topics.length ? tagResult.topics : null;
        else if (tagResult.topics.length) patch.topics = mergeListValues(post.topics, tagResult.topics);
        if (shouldReplaceOldAiFields) patch.keywords = mergeListValues(matchedKeywords, tagResult.keywords);
        else if (tagResult.keywords.length) patch.keywords = mergeListValues(post.keywords, tagResult.keywords);
        patch.tagStatus = tagResult.topics.length || tagResult.keywords.length ? "generated" : "skipped";
        rawAi.tag = {
          result: tagResult.raw,
          prompt: tagResult.promptTrace,
        };
      }
      if (shouldGenerateSummary) {
        const [summaryZhResult, summaryEnResult] = await Promise.all([
          shouldGenerateSummary ? callTweetSummaryAi(board, post, "chinese") : Promise.resolve({ summary: post.summaryZh, promptTrace: buildPromptTrace(board, PROMPT_FIELDS.TWEET_SUMMARY), raw: {} }),
          shouldGenerateSummary ? callTweetSummaryAi(board, post, "english") : Promise.resolve({ summary: post.summaryEn, promptTrace: buildPromptTrace(board, PROMPT_FIELDS.TWEET_SUMMARY), raw: {} }),
        ]);
        const summaryZh = summaryZhResult.summary;
        const summaryEn = summaryEnResult.summary;
        if (summaryZh || shouldReplaceOldAiFields) patch.summaryZh = summaryZh || null;
        if (summaryEn || shouldReplaceOldAiFields) patch.summaryEn = summaryEn || null;
        patch.summaryStatus = summaryZh || summaryEn ? "generated" : "skipped";
        rawAi.summary = {
          summaryZh,
          summaryEn,
          prompt: summaryZhResult.promptTrace || summaryEnResult.promptTrace,
          raw: { zh: summaryZhResult.raw, en: summaryEnResult.raw },
        };
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

  return { enabled: true, analyzed, failed, skipped, promptOverrides };
}

async function analyzePendingProjectAttitudes(board, options = {}) {
  const aiConfig = await getAiConfig();
  if (!await isProjectAttitudeEnabled()) return { enabled: false, analyzed: 0, failed: 0 };
  const limit = Math.min(Math.max(Number(options.limit || aiConfig.projectAttitudeBatchSize || 20), 1), 100);
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
  const promptOverrides = countPromptOverrides(board, [PROMPT_FIELDS.PROJECT_ATTITUDE]);
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
          projectAttitude: {
            score: result.score,
            sentiment: result.sentiment,
            summary: result.summary,
            prompt: result.promptTrace,
            raw: result.raw,
          },
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
  return { enabled: true, analyzed, failed, promptOverrides };
}

module.exports = {
  isContentAiEnabled,
  isProjectAttitudeEnabled,
  scoreToSentiment,
  buildPromptTrace,
  callProjectAttitudeAi,
  analyzePendingContentMetadata,
  analyzePendingProjectAttitudes,
};
