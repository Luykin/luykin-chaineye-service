const { Op, literal } = require("sequelize");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");
const { SENTIMENTS } = require("../constants");
const { normalizeTweetText } = require("../utils/text-normalize");

const { getSocialListeningRuntimeConfig } = require("./runtime-config");
const {
  PROMPT_FIELDS,
  PROMPT_ALIASES,
  STRICT_DOMAIN_TAG_VERSION,
  STRICT_DOMAIN_TAGS,
  STRICT_CRYPTO_SUB_TAGS,
  STRICT_AI_SUB_TAGS,
  DEFAULT_LOCAL_AI_PROMPTS,
  LEGACY_FRONTEND_AI_PROMPTS,
} = require("./ai-prompt-templates");
const {
  generateTweetAnalysis,
  generateTweetTagV2,
  generateProjectAttitude,
  generateTweetSummaryMedia,
} = require("./local-ai-service");


function clampInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function getPostAiText(post, options = {}) {
  const rawText = normalizeTweetText(post.text || post.normalizedText || "");
  const maxLength = clampInteger(options.maxTextLength, 1200, 200, 5000);
  const truncated = rawText.length > maxLength;
  return {
    text: truncated ? rawText.slice(0, maxLength) : rawText,
    rawLength: rawText.length,
    truncated,
    maxLength,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const limit = clampInteger(concurrency, 1, 1, 20);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }));
}

function getAiTextLengthOrder() {
  return literal('length(coalesce("text", "normalizedText", \'\'))');
}

function summarizeError(error) {
  return String(error?.message || error).slice(0, 1000);
}

async function getAiConfig() {
  const config = await getSocialListeningRuntimeConfig();
  return config.ai || {};
}

function getBoardAiRuntime(board) {
  const metadata = getBoardMetadata(board);
  return metadata.aiRuntime && typeof metadata.aiRuntime === "object" ? metadata.aiRuntime : {};
}

async function getBoardAiConfig(board) {
  const runtimeAi = await getAiConfig();
  const boardAi = getBoardAiRuntime(board);
  const boardModel = String(boardAi.model || "").trim();
  const tweetAnalysisModel = String(boardAi.tweetAnalysisModel || runtimeAi.tweetAnalysisModel || "").trim();
  const contentModelReady = Boolean(boardModel || tweetAnalysisModel || boardAi.tweetTagModel || boardAi.tweetSummaryModel);
  const attitudeModelReady = Boolean(boardModel || tweetAnalysisModel || boardAi.projectAttitudeModel);
  return {
    ...runtimeAi,
    ...boardAi,
    apiKey: runtimeAi.apiKey,
    baseURL: boardAi.baseURL || runtimeAi.baseURL,
    model: boardModel,
    tweetAnalysisModel,
    tweetTagModel: boardAi.tweetTagModel || tweetAnalysisModel || boardModel,
    tweetSummaryModel: boardAi.tweetSummaryModel || tweetAnalysisModel || boardModel,
    projectAttitudeModel: boardAi.projectAttitudeModel || tweetAnalysisModel || boardModel,
    prompts: {
      ...(runtimeAi.prompts && typeof runtimeAi.prompts === "object" ? runtimeAi.prompts : {}),
      ...(boardAi.prompts && typeof boardAi.prompts === "object" ? boardAi.prompts : {}),
    },
    contentEnabled: Boolean(runtimeAi.contentEnabled && boardAi.contentEnabled && contentModelReady),
    projectAttitudeEnabled: Boolean(runtimeAi.projectAttitudeEnabled && boardAi.projectAttitudeEnabled && attitudeModelReady),
  };
}

function hasLocalAiConfig(aiConfig = {}) {
  return Boolean(String(aiConfig.apiKey || "").trim() && String(aiConfig.baseURL || "").trim());
}

async function isProjectAttitudeEnabled(board) {
  const aiConfig = await getBoardAiConfig(board);
  return Boolean(aiConfig.projectAttitudeEnabled && hasLocalAiConfig(aiConfig));
}

async function isContentAiEnabled(board) {
  const aiConfig = await getBoardAiConfig(board);
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

function normalizePromptForCompare(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n");
}

function isDefaultEquivalentPrompt(field, prompt) {
  const normalized = normalizePromptForCompare(prompt);
  return Boolean(
    normalized &&
    (
      normalized === normalizePromptForCompare(DEFAULT_LOCAL_AI_PROMPTS[field]) ||
      normalized === normalizePromptForCompare(LEGACY_FRONTEND_AI_PROMPTS[field])
    )
  );
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

  if (runtimeTemplate && !isDefaultEquivalentPrompt(field, runtimeTemplate)) {
    template = runtimeTemplate;
    source = "nacos.echohunt_social_listening_config.ai.prompts";
    configured = true;
  }
  if (boardTemplate && !isDefaultEquivalentPrompt(field, boardTemplate)) {
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
  const prompt = getBoardPrompt(board, field);
  return Boolean(prompt && !isDefaultEquivalentPrompt(field, prompt));
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

function normalizeSentiment(value) {
  const sentiment = String(value || "").trim().toLowerCase();
  return Object.values(SENTIMENTS).includes(sentiment) ? sentiment : "";
}

function buildProjectPromptName(board) {
  const metadata = getBoardMetadata(board);
  return String(metadata.aiProjectName || board.projectName || board.officialHandle || "").trim();
}

async function callProjectAttitudeAi(board, post, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  const aiText = getPostAiText(post, options);
  const text = `<<${new Date(post.postCreatedAt).toISOString()}--${aiText.text}>>`;
  const project = buildProjectPromptName(board);
  const promptVariables = { text, project, lang: "cn" };
  const { prompt, trace: promptTrace } = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.PROJECT_ATTITUDE, promptVariables);
  const data = await generateProjectAttitude({ prompt, aiConfig });

  const score = data.score ?? data.data?.score;
  const source = data.data && typeof data.data === "object" ? data.data : data;
  const explicitSentiment = normalizeSentiment(source.sentiment);
  const relevantToProject = source.relevant_to_project ?? source.relevantToProject;
  const rawConfidence = source.confidence;
  const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === "" ? NaN : Number(rawConfidence);
  const sentiment = explicitSentiment || scoreToSentiment(score, aiConfig);
  const strictSentiment = (
    sentiment === SENTIMENTS.UNKNOWN ||
    relevantToProject === false ||
    (Number.isFinite(confidence) && confidence < 0.5)
  ) ? SENTIMENTS.UNKNOWN : sentiment;
  return {
    score,
    sentiment: strictSentiment,
    relevantToProject: relevantToProject === undefined ? null : Boolean(relevantToProject),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
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

const DOMAIN_TAG_ALIAS_MAP = new Map([
  ["crypto", "crypto"],
  ["web3", "crypto"],
  ["blockchain", "crypto"],
  ["区块链", "crypto"],
  ["加密", "crypto"],
  ["ai", "ai"],
  ["人工智能", "ai"],
  ["科技", "科技"],
  ["tech", "科技"],
  ["technology", "科技"],
  ["金融", "金融"],
  ["finance", "金融"],
  ["fintech", "金融"],
  ["内容创作", "内容创作"],
  ["creator", "内容创作"],
  ["content", "内容创作"],
  ["other", "其他"],
  ["unknown", "其他"],
  ["其它", "其他"],
  ["其他", "其他"],
  ["抽奖", "抽奖"],
  ["giveaway", "抽奖"],
  ["airdrop", "抽奖"],
]);

function normalizeForStrictCompare(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStrictDomainTag(value) {
  const raw = String(value || "").trim();
  if (STRICT_DOMAIN_TAGS.includes(raw)) return raw;
  return DOMAIN_TAG_ALIAS_MAP.get(normalizeForStrictCompare(raw)) || "其他";
}

function normalizeStrictList(value, allowedList, limit) {
  const canonical = new Map(allowedList.map((item) => [normalizeForStrictCompare(item), item]));
  const output = [];
  for (const item of normalizeList(value)) {
    const normalized = canonical.get(normalizeForStrictCompare(item));
    if (!normalized || output.includes(normalized)) continue;
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-.,!?，。！？:：;；()[\]{}"'“”‘’`]+/g, "");
}

function hotTagAppearsInText(tag, text) {
  const raw = String(tag || "").trim();
  const stripped = raw.replace(/^[$#@]+/, "").trim();
  if (!stripped || stripped.length > 80) return false;
  if (/^[a-z0-9]+$/i.test(stripped) && stripped.length < 2) return false;
  const haystack = normalizeSearchText(text);
  return Boolean(haystack && normalizeSearchText(stripped) && haystack.includes(normalizeSearchText(stripped)));
}

function normalizeHotTags(value, text, limit = 12) {
  const output = [];
  for (const item of normalizeList(value)) {
    const tag = String(item || "").trim().slice(0, 80);
    if (!hotTagAppearsInText(tag, text) || output.includes(tag)) continue;
    output.push(tag);
    if (output.length >= limit) break;
  }
  return output;
}

function extractTagResult(data = {}, text = "") {
  const source = data.data && typeof data.data === "object" ? data.data : data;
  const domainTag = normalizeStrictDomainTag(source.domain_tag || source.domainTag);
  const cryptoSubTags = normalizeStrictList(source.crypto_sub_tags || source.cryptoSubTags, STRICT_CRYPTO_SUB_TAGS, 8);
  const aiSubTags = normalizeStrictList(source.ai_sub_tags || source.aiSubTags, STRICT_AI_SUB_TAGS, 8);
  const hotTags = normalizeHotTags(mergeListValues(source.hot_tags, source.hotTags, source.keywords), text, 12);
  const topics = mergeListValues(
    domainTag === "其他" ? [] : [domainTag],
    cryptoSubTags,
    aiSubTags
  );
  return {
    topics,
    keywords: hotTags,
    raw: {
      ...source,
      domain_tag: domainTag,
      domain_tag_version: STRICT_DOMAIN_TAG_VERSION,
      crypto_sub_tags: cryptoSubTags,
      ai_sub_tags: aiSubTags,
      hot_tags: hotTags,
      socialListeningStrict: {
        version: STRICT_DOMAIN_TAG_VERSION,
        ignoredFreeformTags: normalizeList(source.tags || source.topics || source.domain_tags),
      },
    },
  };
}

function extractSummaryResult(data = {}) {
  const source = data.data && typeof data.data === "object" ? data.data : data;
  return {
    postZh: source.post_zh || source.postZh || null,
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

async function callTweetTagAi(board, post, options = {}) {
  const { text } = getPostAiText(post, options);
  const promptVariables = { text };
  const aiConfig = await getBoardAiConfig(board);
  const { prompt, trace: promptTrace } = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.TWEET_TAG, promptVariables);
  if (!text) return { topics: [], keywords: [], raw: {}, promptTrace };
  const data = await generateTweetTagV2({ prompt, aiConfig });
  return { ...extractTagResult(data, text), promptTrace };
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

async function callTweetSummaryAi(board, post, lang, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  const summaryWords = aiConfig.summaryWords || 5;
  const { text } = getPostAiText(post, options);
  const promptVariables = { text, lang, words: summaryWords, media: pickFirstMedia(post) };
  const { prompt, trace: promptTrace } = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.TWEET_SUMMARY, promptVariables);
  if (!text) return { summary: "", promptTrace, raw: {} };
  const data = await generateTweetSummaryMedia({ prompt, aiConfig });
  const summary = typeof data === "string" ? data : (data.summary || data.text || "");
  const postZh = typeof data === "object" ? (data.post_zh || data.postZh || "") : "";
  return { summary, postZh, promptTrace, raw: typeof data === "object" ? data : { text: data } };
}

function buildCombinedPromptSection(board, aiConfig, field, variables = {}) {
  const promptVariables = {
    ...variables,
    text: "见下方 INPUT.tweet_text，不要在这里重复正文。",
  };
  const { prompt, trace } = buildPromptInfo(board, aiConfig, field, promptVariables);
  return { prompt, trace };
}

async function callTweetAnalysisAi(board, post, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  const summaryWords = aiConfig.summaryWords || 5;
  const aiText = getPostAiText(post, options);
  const project = buildProjectPromptName(board);
  const media = pickFirstMedia(post);
  const createdAt = post.postCreatedAt ? new Date(post.postCreatedAt).toISOString() : "";
  const variables = {
    text: aiText.text,
    project,
    lang: "cn",
    words: summaryWords,
    media,
    createdAt,
  };
  const analysisPrompt = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.TWEET_ANALYSIS, variables);
  const tagPrompt = buildCombinedPromptSection(board, aiConfig, PROMPT_FIELDS.TWEET_TAG, variables);
  const summaryPrompt = buildCombinedPromptSection(board, aiConfig, PROMPT_FIELDS.TWEET_SUMMARY, variables);
  const attitudePrompt = buildCombinedPromptSection(board, aiConfig, PROMPT_FIELDS.PROJECT_ATTITUDE, {
    ...variables,
    text: `<<${createdAt}--${aiText.text}>>`,
  });
  const prompt = analysisPrompt.trace.configured || (!tagPrompt.trace.configured && !summaryPrompt.trace.configured && !attitudePrompt.trace.configured)
    ? analysisPrompt.prompt
    : [
      "你是 Crypto/Web3/AI 社媒内容结构化分析助手。请只读取 INPUT.tweet_text 一次，并一次性完成标签、摘要、项目态度三类结果。",
      "重要要求：不要翻译推文全文，不要输出 post_zh；只需要给 summary_cn、summary_en 和 attitude_summary。不要添加原文没有的信息。",
      `中文摘要尽量不超过 ${summaryWords} 个词/短语；英文摘要尽量短句。`,
      "",
      "标签规则：",
      tagPrompt.prompt,
      "",
      "摘要规则：",
      summaryPrompt.prompt,
      "",
      "项目态度规则：",
      attitudePrompt.prompt,
      "",
      `INPUT:\n${JSON.stringify({
        tweet_text: aiText.text,
        tweet_created_at: createdAt,
        project,
        media,
      })}`,
    ].join("\n");
  const promptTrace = { analysis: analysisPrompt.trace, tag: tagPrompt.trace, summary: summaryPrompt.trace, attitude: attitudePrompt.trace, length: prompt.length };
  if (!aiText.text) {
    return {
      tag: { topics: [], keywords: [], raw: {}, promptTrace: tagPrompt.trace },
      summary: { postZh: null, summaryZh: null, summaryEn: null, raw: {} },
      attitude: { score: 5, sentiment: SENTIMENTS.UNKNOWN, relevantToProject: null, confidence: null, summary: null, raw: {} },
      promptTrace,
      raw: {},
    };
  }
  const data = await generateTweetAnalysis({ prompt, aiConfig });
  const tag = extractTagResult(data, aiText.text);
  const summary = extractSummaryResult(data);
  const explicitSentiment = normalizeSentiment(data.sentiment);
  const relevantToProject = data.relevant_to_project ?? data.relevantToProject;
  const rawConfidence = data.confidence;
  const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === "" ? NaN : Number(rawConfidence);
  const sentiment = explicitSentiment || scoreToSentiment(data.score, aiConfig);
  const strictSentiment = (
    sentiment === SENTIMENTS.UNKNOWN ||
    relevantToProject === false ||
    (Number.isFinite(confidence) && confidence < 0.5)
  ) ? SENTIMENTS.UNKNOWN : sentiment;
  return {
    tag: { ...tag, promptTrace: tagPrompt.trace },
    summary: { ...summary, postZh: null, promptTrace: summaryPrompt.trace },
    attitude: {
      score: data.score,
      sentiment: strictSentiment,
      relevantToProject: relevantToProject === undefined ? null : Boolean(relevantToProject),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      summary: data.attitude_summary || data.attitudeSummary || data.summary || null,
      raw: data,
      promptTrace: attitudePrompt.trace,
    },
    promptTrace,
    raw: data,
  };
}

function isPendingContentPost(post) {
  return (
    !Array.isArray(post.topics) ||
    !post.topics.length ||
    !hasSummaryFields(post) ||
    ["pending", "failed", "reused"].includes(post.tagStatus || "") ||
    ["pending", "failed", "reused"].includes(post.summaryStatus || "") ||
    post.aiSource === "dev_tweet_ai"
  );
}

function isPendingAttitudePost(post) {
  return !post.attitudeStatus || ["pending", "failed"].includes(post.attitudeStatus);
}

function isDoneStatus(status) {
  return ["generated", "skipped", "succeeded"].includes(status || "");
}

function buildCombinedAiStatus({ contentEnabled, attitudeEnabled, tagStatus, summaryStatus, attitudeStatus }) {
  const contentDone = !contentEnabled || (isDoneStatus(tagStatus) && isDoneStatus(summaryStatus));
  const attitudeDone = !attitudeEnabled || attitudeStatus === "succeeded" || attitudeStatus === "skipped";
  return contentDone && attitudeDone ? "succeeded" : "partial";
}

async function analyzePendingPostAi(board, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  const contentEnabled = Boolean(aiConfig.contentEnabled && hasLocalAiConfig(aiConfig));
  const attitudeEnabled = Boolean(aiConfig.projectAttitudeEnabled && hasLocalAiConfig(aiConfig));
  if (!contentEnabled && !attitudeEnabled) {
    return {
      enabled: false,
      content: { enabled: false, selected: 0, analyzed: 0, failed: 0, skipped: 0 },
      attitude: { enabled: false, selected: 0, analyzed: 0, failed: 0 },
    };
  }
  const limit = clampInteger(options.limit || Math.max(aiConfig.contentBatchSize || 10, aiConfig.projectAttitudeBatchSize || 20), 20, 1, 1000);
  const concurrency = clampInteger(options.concurrency || Math.max(aiConfig.contentConcurrency || 1, aiConfig.projectAttitudeConcurrency || 1), 4, 1, 20);
  const maxTextLength = clampInteger(options.maxTextLength || aiConfig.maxTextLength, 1200, 200, 5000);
  const pendingClauses = [];
  if (contentEnabled) {
    pendingClauses.push(
      { tagStatus: null },
      { tagStatus: { [Op.in]: ["pending", "failed", "reused"] } },
      { summaryStatus: null },
      { summaryStatus: { [Op.in]: ["pending", "failed", "reused"] } },
      { aiSource: "dev_tweet_ai" }
    );
  }
  if (attitudeEnabled) {
    pendingClauses.push(
      { attitudeStatus: null },
      { attitudeStatus: { [Op.in]: ["pending", "failed"] } }
    );
  }
  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      text: { [Op.ne]: null },
      [Op.or]: pendingClauses,
    },
    order: [
      [getAiTextLengthOrder(), "ASC"],
      ["authorGlobalRank", "ASC"],
      ["viewsCount", "DESC"],
      ["postCreatedAt", "DESC"],
    ],
    limit,
  });

  const content = { enabled: contentEnabled, selected: 0, analyzed: 0, failed: 0, skipped: 0 };
  const attitude = { enabled: attitudeEnabled, selected: 0, analyzed: 0, failed: 0 };
  const startedAt = Date.now();
  const promptOverrides = countPromptOverrides(board, [PROMPT_FIELDS.TWEET_ANALYSIS, PROMPT_FIELDS.TWEET_TAG, PROMPT_FIELDS.TWEET_SUMMARY, PROMPT_FIELDS.PROJECT_ATTITUDE]);
  await runWithConcurrency(posts, concurrency, async (post) => {
    const itemStartedAt = Date.now();
    const aiText = getPostAiText(post, { maxTextLength });
    const shouldGenerateContent = contentEnabled && isPendingContentPost(post);
    const shouldGenerateAttitude = attitudeEnabled && isPendingAttitudePost(post);
    if (!shouldGenerateContent && !shouldGenerateAttitude) return;
    if (shouldGenerateContent) content.selected += 1;
    if (shouldGenerateAttitude) attitude.selected += 1;
    if (!aiText.text || aiText.text.length < 8) {
      if (shouldGenerateContent) content.skipped += 1;
      await post.update({
        tagStatus: shouldGenerateContent && (post.tagStatus === "pending" || !post.tagStatus) ? "skipped" : post.tagStatus,
        summaryStatus: shouldGenerateContent && (post.summaryStatus === "pending" || !post.summaryStatus) ? "skipped" : post.summaryStatus,
        attitudeStatus: shouldGenerateAttitude && (post.attitudeStatus === "pending" || !post.attitudeStatus) ? "skipped" : post.attitudeStatus,
        aiStatus: "skipped",
      }).catch(() => null);
      console.log(`[SocialListeningAI] combined board=${board.id} post=${post.id} tweet=${post.tweetId} status=skipped ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated}`);
      return;
    }

    try {
      const result = await callTweetAnalysisAi(board, post, { maxTextLength });
      const patch = {};
      const rawAi = { ...(post.rawTweet?.socialListeningAi || {}) };
      const shouldReplaceOldAiFields = post.aiSource === "dev_tweet_ai" || post.tagStatus === "reused" || post.summaryStatus === "reused";

      if (shouldGenerateContent) {
        const matchedKeywords = Array.isArray(post.rawTweet?.matchedKeywords) ? post.rawTweet.matchedKeywords : [];
        if (shouldReplaceOldAiFields) patch.topics = result.tag.topics.length ? result.tag.topics : null;
        else if (result.tag.topics.length) patch.topics = mergeListValues(post.topics, result.tag.topics);
        if (shouldReplaceOldAiFields) patch.keywords = mergeListValues(matchedKeywords, result.tag.keywords);
        else if (result.tag.keywords.length) patch.keywords = mergeListValues(post.keywords, result.tag.keywords);
        patch.tagStatus = result.tag.topics.length || result.tag.keywords.length ? "generated" : "skipped";
        if (result.summary.summaryZh || shouldReplaceOldAiFields) patch.summaryZh = result.summary.summaryZh || null;
        if (result.summary.summaryEn || shouldReplaceOldAiFields) patch.summaryEn = result.summary.summaryEn || null;
        patch.summaryStatus = result.summary.summaryZh || result.summary.summaryEn ? "generated" : "skipped";
        rawAi.tag = {
          result: result.tag.raw,
          prompt: result.tag.promptTrace,
        };
        rawAi.summary = {
          summaryZh: result.summary.summaryZh,
          summaryEn: result.summary.summaryEn,
          prompt: result.summary.promptTrace,
          raw: result.summary.raw,
        };
      }

      if (shouldGenerateAttitude) {
        patch.projectAttitudeScore = result.attitude.score;
        patch.sentimentScore = result.attitude.score;
        patch.sentiment = result.attitude.sentiment;
        patch.sentimentSummaryZh = result.attitude.summary;
        patch.attitudeStatus = "succeeded";
        rawAi.projectAttitude = {
          score: result.attitude.score,
          sentiment: result.attitude.sentiment,
          relevantToProject: result.attitude.relevantToProject,
          confidence: result.attitude.confidence,
          summary: result.attitude.summary,
          prompt: result.attitude.promptTrace,
          raw: result.attitude.raw,
        };
      }

      await post.update({
        ...patch,
        aiStatus: buildCombinedAiStatus({
          contentEnabled,
          attitudeEnabled,
          tagStatus: patch.tagStatus || post.tagStatus,
          summaryStatus: patch.summaryStatus || post.summaryStatus,
          attitudeStatus: patch.attitudeStatus || post.attitudeStatus,
        }),
        aiAnalyzedAt: new Date(),
        aiError: null,
        aiSource: "social_listening_combined",
        rawTweet: {
          ...(post.rawTweet || {}),
          socialListeningAi: rawAi,
        },
      });
      if (shouldGenerateContent) content.analyzed += 1;
      if (shouldGenerateAttitude) attitude.analyzed += 1;
      console.log(`[SocialListeningAI] combined board=${board.id} post=${post.id} tweet=${post.tweetId} status=ok ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} content=${shouldGenerateContent} attitude=${shouldGenerateAttitude}`);
    } catch (error) {
      if (shouldGenerateContent) content.failed += 1;
      if (shouldGenerateAttitude) attitude.failed += 1;
      await post.update({
        tagStatus: shouldGenerateContent && ["pending", "failed", null].includes(post.tagStatus) ? "failed" : post.tagStatus,
        summaryStatus: shouldGenerateContent && ["pending", "failed", null].includes(post.summaryStatus) ? "failed" : post.summaryStatus,
        sentiment: shouldGenerateAttitude ? SENTIMENTS.UNKNOWN : post.sentiment,
        attitudeStatus: shouldGenerateAttitude ? "failed" : post.attitudeStatus,
        aiAnalyzedAt: new Date(),
        aiError: summarizeError(error),
      }).catch(() => null);
      console.warn(`[SocialListeningAI] combined board=${board.id} post=${post.id} tweet=${post.tweetId} status=failed ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} content=${shouldGenerateContent} attitude=${shouldGenerateAttitude} error=${summarizeError(error)}`);
    }
  });

  const durationMs = Date.now() - startedAt;
  console.log(`[SocialListeningAI] combined batch board=${board.id} posts=${posts.length} content=${content.analyzed}/${content.selected} contentFailed=${content.failed} attitude=${attitude.analyzed}/${attitude.selected} attitudeFailed=${attitude.failed} concurrency=${concurrency} maxTextLength=${maxTextLength} ms=${durationMs}`);
  return { enabled: true, content, attitude, promptOverrides, selected: posts.length, concurrency, maxTextLength, durationMs };
}

async function analyzePendingContentMetadata(board, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  if (!await isContentAiEnabled(board)) return { enabled: false, analyzed: 0, failed: 0, skipped: 0 };
  const limit = clampInteger(options.limit || aiConfig.contentBatchSize, 10, 1, 500);
  const concurrency = clampInteger(options.concurrency || aiConfig.contentConcurrency, 1, 1, 20);
  const maxTextLength = clampInteger(options.maxTextLength || aiConfig.maxTextLength, 1200, 200, 5000);
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
      [getAiTextLengthOrder(), "ASC"],
      ["authorGlobalRank", "ASC"],
      ["viewsCount", "DESC"],
      ["postCreatedAt", "DESC"],
    ],
    limit,
  });

  let analyzed = 0;
  let failed = 0;
  let skipped = 0;
  const startedAt = Date.now();
  const promptOverrides = countPromptOverrides(board, [PROMPT_FIELDS.TWEET_TAG, PROMPT_FIELDS.TWEET_SUMMARY]);
  await runWithConcurrency(posts, concurrency, async (post) => {
    const itemStartedAt = Date.now();
    const aiText = getPostAiText(post, { maxTextLength });
    if (!aiText.text || aiText.text.length < 8) {
      skipped += 1;
      await post.update({
        tagStatus: post.tagStatus === "pending" || !post.tagStatus ? "skipped" : post.tagStatus,
        summaryStatus: post.summaryStatus === "pending" || !post.summaryStatus ? "skipped" : post.summaryStatus,
        aiStatus: "skipped",
      }).catch(() => null);
      console.log(`[SocialListeningAI] content board=${board.id} post=${post.id} tweet=${post.tweetId} status=skipped ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated}`);
      return;
    }

    try {
      const patch = {};
      const rawAi = { ...(post.rawTweet?.socialListeningAi || {}) };
      const shouldGenerateTag = !Array.isArray(post.topics) || !post.topics.length || ["pending", "failed", "reused"].includes(post.tagStatus || "");
      const shouldGenerateSummary = !hasSummaryFields(post) || ["pending", "failed", "reused"].includes(post.summaryStatus || "") || post.aiSource === "dev_tweet_ai";
      const shouldReplaceOldAiFields = post.aiSource === "dev_tweet_ai" || post.tagStatus === "reused" || post.summaryStatus === "reused";

      if (shouldGenerateTag) {
        const tagResult = await callTweetTagAi(board, post, { maxTextLength });
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
          callTweetSummaryAi(board, post, "chinese", { maxTextLength }),
          callTweetSummaryAi(board, post, "english", { maxTextLength }),
        ]);
        const summaryZh = summaryZhResult.summary;
        const summaryEn = summaryEnResult.summary;
        const postZh = summaryZhResult.postZh;
        if (postZh || shouldReplaceOldAiFields) patch.postZh = postZh || null;
        if (summaryZh || shouldReplaceOldAiFields) patch.summaryZh = summaryZh || null;
        if (summaryEn || shouldReplaceOldAiFields) patch.summaryEn = summaryEn || null;
        patch.summaryStatus = postZh || summaryZh || summaryEn ? "generated" : "skipped";
        rawAi.summary = {
          postZh,
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
      console.log(`[SocialListeningAI] content board=${board.id} post=${post.id} tweet=${post.tweetId} status=ok ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} tag=${patch.tagStatus || post.tagStatus || "keep"} summary=${patch.summaryStatus || post.summaryStatus || "keep"}`);
    } catch (error) {
      failed += 1;
      await post.update({
        tagStatus: ["pending", "failed", null].includes(post.tagStatus) ? "failed" : post.tagStatus,
        summaryStatus: ["pending", "failed", null].includes(post.summaryStatus) ? "failed" : post.summaryStatus,
        aiAnalyzedAt: new Date(),
        aiError: summarizeError(error),
      }).catch(() => null);
      console.warn(`[SocialListeningAI] content board=${board.id} post=${post.id} tweet=${post.tweetId} status=failed ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} error=${summarizeError(error)}`);
    }
  });

  console.log(`[SocialListeningAI] content batch board=${board.id} posts=${posts.length} analyzed=${analyzed} failed=${failed} skipped=${skipped} concurrency=${concurrency} maxTextLength=${maxTextLength} ms=${Date.now() - startedAt}`);
  return { enabled: true, analyzed, failed, skipped, promptOverrides, selected: posts.length, concurrency, maxTextLength, durationMs: Date.now() - startedAt };
}

async function analyzePendingProjectAttitudes(board, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  if (!await isProjectAttitudeEnabled(board)) return { enabled: false, analyzed: 0, failed: 0 };
  const limit = clampInteger(options.limit || aiConfig.projectAttitudeBatchSize, 20, 1, 1000);
  const concurrency = clampInteger(options.concurrency || aiConfig.projectAttitudeConcurrency, 1, 1, 30);
  const maxTextLength = clampInteger(options.maxTextLength || aiConfig.maxTextLength, 1200, 200, 5000);
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
      [getAiTextLengthOrder(), "ASC"],
      ["authorGlobalRank", "ASC"],
      ["viewsCount", "DESC"],
      ["postCreatedAt", "DESC"],
    ],
    limit,
  });

  let analyzed = 0;
  let failed = 0;
  const startedAt = Date.now();
  const promptOverrides = countPromptOverrides(board, [PROMPT_FIELDS.PROJECT_ATTITUDE]);
  await runWithConcurrency(posts, concurrency, async (post) => {
    const itemStartedAt = Date.now();
    const aiText = getPostAiText(post, { maxTextLength });
    try {
      const result = await callProjectAttitudeAi(board, post, { maxTextLength });
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
            relevantToProject: result.relevantToProject,
            confidence: result.confidence,
            summary: result.summary,
            prompt: result.promptTrace,
            raw: result.raw,
          },
        },
      });
      analyzed += 1;
      console.log(`[SocialListeningAI] attitude board=${board.id} post=${post.id} tweet=${post.tweetId} status=ok sentiment=${result.sentiment} score=${result.score} ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated}`);
    } catch (error) {
      failed += 1;
      await post.update({
        sentiment: SENTIMENTS.UNKNOWN,
        attitudeStatus: "failed",
        aiAnalyzedAt: new Date(),
        aiError: summarizeError(error),
      }).catch(() => null);
      console.warn(`[SocialListeningAI] attitude board=${board.id} post=${post.id} tweet=${post.tweetId} status=failed ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} error=${summarizeError(error)}`);
    }
  });
  console.log(`[SocialListeningAI] attitude batch board=${board.id} posts=${posts.length} analyzed=${analyzed} failed=${failed} concurrency=${concurrency} maxTextLength=${maxTextLength} ms=${Date.now() - startedAt}`);
  return { enabled: true, analyzed, failed, promptOverrides, selected: posts.length, concurrency, maxTextLength, durationMs: Date.now() - startedAt };
}

module.exports = {
  isContentAiEnabled,
  isProjectAttitudeEnabled,
  getBoardAiConfig,
  scoreToSentiment,
  buildPromptTrace,
  callProjectAttitudeAi,
  analyzePendingPostAi,
  analyzePendingContentMetadata,
  analyzePendingProjectAttitudes,
};
