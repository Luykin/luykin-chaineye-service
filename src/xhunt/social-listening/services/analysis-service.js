const { Op, literal, fn, col, where } = require("sequelize");
const { createHash } = require("crypto");
const {
  EchohuntSocialListeningPost,
  EchohuntSocialListeningTextCondensation,
} = require("../../../models/postgres-start");
const { SENTIMENTS } = require("../constants");
const { normalizeTweetText } = require("../utils/text-normalize");
const { normalizeTwitterHandle } = require("../utils/twitter");

const { getSocialListeningRuntimeConfig } = require("./runtime-config");
const {
  PROMPT_FIELDS,
  PROMPT_ALIASES,
  STRICT_DOMAIN_TAG_VERSION,
  STRICT_DOMAIN_TAGS,
  STRICT_CRYPTO_SUB_TAGS,
  STRICT_AI_SUB_TAGS,
  DEFAULT_LOCAL_AI_PROMPTS,
} = require("./ai-prompt-templates");
const { generateTweetAnalysis, generateTweetTextCondensation } = require("./local-ai-service");
const { fetchTweetRowsByIds } = require("./data-source");

const LONG_TEXT_CONDENSATION_MIN_LENGTH = 900;
const LONG_TEXT_CONDENSATION_MAX_LENGTH = 1800;
const LONG_TEXT_CONDENSATION_RULE_VERSION = "ratio-v1";

function clampInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function truncateText(value, maxLength) {
  return Array.from(String(value || "")).slice(0, maxLength).join("");
}

function textHash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function getLongTextCondensationTargetLength(sourceLength, maxLength) {
  const safeMaxLength = clampInteger(
    maxLength,
    LONG_TEXT_CONDENSATION_MAX_LENGTH,
    LONG_TEXT_CONDENSATION_MIN_LENGTH,
    LONG_TEXT_CONDENSATION_MAX_LENGTH
  );
  const preferredLength = Math.round(Number(sourceLength || 0) / 3);
  return Math.min(safeMaxLength, Math.max(LONG_TEXT_CONDENSATION_MIN_LENGTH, preferredLength));
}

function getPostAiText(post, options = {}) {
  const rawText = normalizeTweetText(post.text || post.normalizedText || "");
  const maxLength = clampInteger(options.maxTextLength, 1200, 200, 5000);
  const tweetId = String(post.tweetId || "");
  const condensedText = normalizeTweetText(options.condensedTextsByTweetId?.get(tweetId) || "");
  const longTextMode = options.longTextModesByTweetId?.get(tweetId) || "";
  const rawLength = Array.from(rawText).length;
  const fallbackTruncated = longTextMode === "truncated";
  const truncated = fallbackTruncated || (!condensedText && rawLength > maxLength);
  return {
    text: condensedText ? truncateText(condensedText, maxLength) : (truncated ? truncateText(rawText, maxLength) : rawText),
    rawLength,
    truncated,
    condensed: longTextMode === "condensed",
    fallbackTruncated,
    maxLength,
  };
}

function getPostReferenceCandidates(post = {}) {
  const currentTweetId = String(post.tweetId || "").trim();
  const directReference = post.quoteId
    ? { tweetId: String(post.quoteId), label: "引用原文" }
    : post.replyId
      ? { tweetId: String(post.replyId), label: "回复对象原文" }
      : null;
  const conversationId = String(post.conversationId || "").trim();
  const rootReference = conversationId && conversationId !== currentTweetId && conversationId !== directReference?.tweetId
    ? { tweetId: conversationId, label: "会话根推文" }
    : null;
  return [directReference, rootReference].filter(Boolean);
}

function getPostReference(post, referenceRowsById, options = {}) {
  const references = getPostReferenceCandidates(post)
    .map((reference) => {
      const rawText = normalizeTweetText(referenceRowsById.get(reference.tweetId)?.text || "");
      const condensedText = normalizeTweetText(options.condensedTextsByTweetId?.get(reference.tweetId) || "");
      const longTextMode = options.longTextModesByTweetId?.get(reference.tweetId) || "";
      return { ...reference, rawText, condensedText, longTextMode };
    })
    .filter((reference) => reference.rawText);
  if (!references.length) return { context: "", rawLength: 0, truncated: false, condensedCount: 0, fallbackTruncatedCount: 0 };

  const maxLength = clampInteger(options.maxReferenceContextLength, 1200, 200, 2000);
  const directLength = references.length > 1 ? Math.max(100, Math.floor(maxLength / 3)) : maxLength;
  const contextParts = references.map((reference, index) => {
    const allowedLength = index === 0 ? directLength : Math.max(100, maxLength - directLength);
    const sourceText = reference.condensedText || reference.rawText;
    const truncated = Array.from(sourceText).length > allowedLength;
    const text = truncated ? truncateText(sourceText, allowedLength) : sourceText;
    return {
      text: `${reference.label}${reference.longTextMode === "condensed" ? "（长文精简，仅作语境，非当前作者观点）" : reference.longTextMode === "truncated" ? "（长文截断，仅作语境，非当前作者观点）" : "（仅作语境，非当前作者观点）"}：${text}`,
      rawLength: Array.from(reference.rawText).length,
      truncated,
      condensed: reference.longTextMode === "condensed",
      fallbackTruncated: reference.longTextMode === "truncated",
    };
  });
  return {
    context: contextParts.map((item) => item.text).join("\n\n"),
    rawLength: contextParts.reduce((total, item) => total + item.rawLength, 0),
    truncated: contextParts.some((item) => item.truncated),
    condensedCount: contextParts.filter((item) => item.condensed).length,
    fallbackTruncatedCount: contextParts.filter((item) => item.fallbackTruncated).length,
  };
}

function getReferenceTweetIds(posts = []) {
  return Array.from(new Set(posts.flatMap((post) => getPostReferenceCandidates(post).map((reference) => reference.tweetId))));
}

async function loadReferenceRowsById(posts = []) {
  const tweetIds = getReferenceTweetIds(posts);
  if (!tweetIds.length) return new Map();
  const rows = await fetchTweetRowsByIds(tweetIds, tweetIds.length);
  return new Map(rows.map((row) => [String(row.id), row]));
}

function collectLongTextCandidates(posts, referenceRowsById, threshold) {
  const candidatesByTweetId = new Map();
  const addCandidate = (tweetId, text) => {
    const normalizedText = normalizeTweetText(text || "");
    const normalizedTweetId = String(tweetId || "").trim();
    if (!normalizedTweetId || Array.from(normalizedText).length <= threshold) return;
    candidatesByTweetId.set(normalizedTweetId, {
      tweetId: normalizedTweetId,
      text: normalizedText,
      // Include the rule version so cached results generated under a different
      // condensation policy are regenerated instead of being reused.
      sourceTextHash: textHash(`${LONG_TEXT_CONDENSATION_RULE_VERSION}:${normalizedText}`),
      sourceTextLength: Array.from(normalizedText).length,
    });
  };
  posts.forEach((post) => addCandidate(post.tweetId, post.text || post.normalizedText));
  referenceRowsById.forEach((row, tweetId) => addCandidate(tweetId, row?.text));
  return Array.from(candidatesByTweetId.values());
}

async function prepareLongTextCondensations(posts, referenceRowsById, aiConfig, options = {}) {
  const threshold = clampInteger(options.threshold || aiConfig.longTextCondensationThreshold, 1800, 500, 10000);
  const maxLength = clampInteger(
    options.maxLength || aiConfig.longTextCondensationMaxLength,
    LONG_TEXT_CONDENSATION_MAX_LENGTH,
    LONG_TEXT_CONDENSATION_MIN_LENGTH,
    LONG_TEXT_CONDENSATION_MAX_LENGTH
  );
  const concurrency = clampInteger(options.concurrency || aiConfig.longTextCondensationConcurrency, 2, 1, 4);
  const candidates = collectLongTextCandidates(posts, referenceRowsById, threshold);
  const condensedTextsByTweetId = new Map();
  const longTextModesByTweetId = new Map();
  const setFallbackTruncation = (candidate) => {
    const targetLength = getLongTextCondensationTargetLength(candidate.sourceTextLength, maxLength);
    condensedTextsByTweetId.set(candidate.tweetId, truncateText(candidate.text, targetLength));
    longTextModesByTweetId.set(candidate.tweetId, "truncated");
  };
  if (!candidates.length) return { condensedTextsByTweetId, longTextModesByTweetId, candidates: 0, cacheHits: 0, generated: 0, failed: 0, threshold, maxLength };

  let cachedRows;
  try {
    cachedRows = await EchohuntSocialListeningTextCondensation.findAll({
      where: { tweetId: { [Op.in]: candidates.map((item) => item.tweetId) } },
      raw: true,
    });
  } catch (error) {
    console.warn(`[SocialListeningAI] load long-text condensations failed: ${summarizeError(error)}`);
    candidates.forEach(setFallbackTruncation);
    return { condensedTextsByTweetId, longTextModesByTweetId, candidates: candidates.length, cacheHits: 0, generated: 0, failed: candidates.length, threshold, maxLength };
  }
  const cachedByTweetId = new Map(cachedRows.map((row) => [String(row.tweetId), row]));
  const missing = candidates.filter((candidate) => {
    const cached = cachedByTweetId.get(candidate.tweetId);
    const condensedText = normalizeTweetText(cached?.condensedText || "");
    if (!cached || cached.sourceTextHash !== candidate.sourceTextHash || !condensedText) return true;
    condensedTextsByTweetId.set(candidate.tweetId, truncateText(condensedText, maxLength));
    longTextModesByTweetId.set(candidate.tweetId, "condensed");
    return false;
  });

  let generated = 0;
  let failed = 0;
  await runWithConcurrency(missing, concurrency, async (candidate) => {
    try {
      const targetLength = getLongTextCondensationTargetLength(candidate.sourceTextLength, maxLength);
      const result = await generateTweetTextCondensation({ text: candidate.text, maxLength: targetLength, aiConfig });
      const condensedText = truncateText(normalizeTweetText(result.condensedText), targetLength);
      if (!condensedText) throw new Error("SOCIAL_LISTENING_TEXT_CONDENSATION_EMPTY_RESULT");
      await EchohuntSocialListeningTextCondensation.upsert({
        tweetId: candidate.tweetId,
        sourceTextHash: candidate.sourceTextHash,
        sourceTextLength: candidate.sourceTextLength,
        condensedText,
        model: result.model || null,
        condensedAt: new Date(),
      });
      condensedTextsByTweetId.set(candidate.tweetId, condensedText);
      longTextModesByTweetId.set(candidate.tweetId, "condensed");
      generated += 1;
    } catch (error) {
      failed += 1;
      setFallbackTruncation(candidate);
      console.warn(`[SocialListeningAI] condense long text failed tweet=${candidate.tweetId} length=${candidate.sourceTextLength}: ${summarizeError(error)}`);
    }
  });
  return {
    condensedTextsByTweetId,
    longTextModesByTweetId,
    candidates: candidates.length,
    cacheHits: candidates.length - missing.length,
    generated,
    failed,
    threshold,
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

function getAiRankOrder() {
  return literal(`
    CASE
      WHEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,kolRank}') ~ '^[0-9]+$'
        AND ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,kolRank}')::int > 0
      THEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,kolRank}')::int
      WHEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,globalRank}') ~ '^[0-9]+$'
        AND ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,globalRank}')::int > 0
      THEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,globalRank}')::int
      WHEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,kolGlobalRank}') ~ '^[0-9]+$'
        AND ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,kolGlobalRank}')::int > 0
      THEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'{feature,rank,kolGlobalRank}')::int
      WHEN "EchohuntSocialListeningPost"."authorGlobalRank" > 0 THEN "EchohuntSocialListeningPost"."authorGlobalRank"
      ELSE 2147483647
    END
  `);
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
  const tweetTextCondensationModel = String(boardAi.tweetTextCondensationModel || boardModel || tweetAnalysisModel || runtimeAi.model || "").trim();
  const modelReady = Boolean(boardModel || tweetAnalysisModel);
  return {
    ...runtimeAi,
    ...boardAi,
    apiKey: runtimeAi.apiKey,
    baseURL: boardAi.baseURL || runtimeAi.baseURL,
    model: boardModel,
    tweetAnalysisModel,
    tweetTextCondensationModel,
    prompts: {
      ...(runtimeAi.prompts && typeof runtimeAi.prompts === "object" ? runtimeAi.prompts : {}),
      ...(boardAi.prompts && typeof boardAi.prompts === "object" ? boardAi.prompts : {}),
    },
    contentEnabled: Boolean(runtimeAi.contentEnabled && boardAi.contentEnabled && modelReady),
    projectAttitudeEnabled: Boolean(runtimeAi.projectAttitudeEnabled && boardAi.projectAttitudeEnabled && modelReady),
  };
}

function hasLocalAiConfig(aiConfig = {}) {
  return Boolean(String(aiConfig.apiKey || "").trim() && String(aiConfig.baseURL || "").trim());
}

function normalizePrompt(value, maxLength = 6000) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, Math.max(200, Number(maxLength) || 6000));
}

function getBoardMetadata(board) {
  return board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
}

function getRecallExcludeAuthorHandles(board) {
  const metadata = getBoardMetadata(board);
  const values = Array.isArray(metadata.recallExcludeAuthorHandles) ? metadata.recallExcludeAuthorHandles : [];
  return Array.from(new Set(values.map(normalizeTwitterHandle).filter(Boolean))).slice(0, 50);
}

function applyRecallExcludeAuthorFilter(queryWhere, board) {
  const handles = getRecallExcludeAuthorHandles(board);
  if (!handles.length) return queryWhere;
  queryWhere[Op.and] = [
    ...(queryWhere[Op.and] || []),
    {
      [Op.or]: [
        { authorHandle: null },
        where(fn("LOWER", col("authorHandle")), { [Op.notIn]: handles }),
      ],
    },
  ];
  return queryWhere;
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
  return Boolean(normalized && normalized === normalizePromptForCompare(DEFAULT_LOCAL_AI_PROMPTS[field]));
}

function renderPromptTemplate(prompt, variables = {}) {
  // 支持配置中常见的 {name} 和 {{name}} 两种写法。后者曾导致
  // {{referenceContext}} 只替换了内层变量，向模型遗留花括号。
  return String(prompt || "").replace(/\{\{([a-zA-Z0-9_]+)\}\}|\{([a-zA-Z0-9_]+)\}/g, (match, doubleBraceKey, singleBraceKey) => {
    const key = doubleBraceKey || singleBraceKey;
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function appendKeywordExclusionRule(prompt, field, variables = {}) {
  const exclusions = String(variables.keywordExclusions || "").trim();
  if (!exclusions || field !== PROMPT_FIELDS.TWEET_ANALYSIS) return prompt;
  if (prompt.includes(exclusions)) return prompt;
  return `${prompt}\n\n关键词输出限制（必须遵守）：以下是词云排除词：${exclusions}。即使它们出现在原文中，也不得输出到 hot_tags（后端会将 hot_tags 写入 keywords）。`;
}

function removeEmptyMediaLine(prompt, media) {
  if (String(media || "").trim()) return prompt;
  // 默认模板及常见自定义模板均以独占一行的“媒体：{media}”表示媒体。
  // 没有媒体时移除整行，避免向模型传递没有内容的字段标签。
  return String(prompt || "").replace(/^[\t ]*(?:媒体|media)\s*[:：][\t ]*(?:\r?\n|$)/gim, "");
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
  prompt = removeEmptyMediaLine(prompt, variables.media);
  prompt = appendKeywordExclusionRule(prompt, field, variables);
  if (variables.text && !prompt.includes(String(variables.text))) {
    prompt = `${prompt}\n\n输入文本：\n${variables.text}`;
  }
  if (variables.referenceContext && !prompt.includes(String(variables.referenceContext))) {
    prompt = `${prompt}\n\n${variables.referenceContext}`;
  }
  return {
    prompt,
    template,
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

function buildProjectPromptAliases(board, project = buildProjectPromptName(board)) {
  const metadata = getBoardMetadata(board);
  return Array.from(new Set([
    project,
    board.projectName,
    board.officialHandle,
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
  ].map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 20).join("、");
}

function getKeywordExclusionValues(board) {
  const metadata = getBoardMetadata(board);
  const wordCloud = metadata.wordCloud && typeof metadata.wordCloud === "object" ? metadata.wordCloud : {};
  return Array.from(new Set([
    ...(Array.isArray(metadata.wordCloudExcludeKeywords) ? metadata.wordCloudExcludeKeywords : []),
    ...(Array.isArray(metadata.wordCloudExcludedKeywords) ? metadata.wordCloudExcludedKeywords : []),
    ...(Array.isArray(wordCloud.excludeKeywords) ? wordCloud.excludeKeywords : []),
  ].map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 100);
}

function buildKeywordExclusions(board) {
  return getKeywordExclusionValues(board).join("、");
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

function normalizeKeywordExclusion(value) {
  return normalizeSearchText(String(value || "").trim().replace(/^[@#$]+/, ""));
}

function shouldPreferKeywordDisplay(current, candidate) {
  const existing = String(current || "").trim();
  const next = String(candidate || "").trim();
  const existingIsLowercaseLatin = existing === existing.toLowerCase() && /[a-z]/.test(existing);
  const nextIsUppercaseAcronym = next === next.toUpperCase() && /^[A-Z0-9]{2,}$/.test(next);
  return existingIsLowercaseLatin && nextIsUppercaseAcronym;
}

function filterExcludedKeywords(values, exclusions = []) {
  const exclusionSet = new Set(normalizeList(exclusions).map(normalizeKeywordExclusion).filter(Boolean));
  const output = [];
  const indexByKeyword = new Map();
  for (const value of normalizeList(values)) {
    const key = normalizeKeywordExclusion(value);
    if (!key || exclusionSet.has(key)) continue;
    const existingIndex = indexByKeyword.get(key);
    if (existingIndex === undefined) {
      indexByKeyword.set(key, output.length);
      output.push(value);
    } else if (shouldPreferKeywordDisplay(output[existingIndex], value)) {
      output[existingIndex] = value;
    }
  }
  return output;
}

function normalizeHotTags(value, text, limit = 12, exclusions = []) {
  const output = [];
  for (const item of filterExcludedKeywords(value, exclusions)) {
    const tag = String(item || "").trim().slice(0, 80);
    if (!hotTagAppearsInText(tag, text) || output.includes(tag)) continue;
    output.push(tag);
    if (output.length >= limit) break;
  }
  return output;
}

function extractTagResult(data = {}, text = "", keywordExclusions = []) {
  const source = data.data && typeof data.data === "object" ? data.data : data;
  const domainTag = normalizeStrictDomainTag(source.domain_tag || source.domainTag);
  const cryptoSubTags = normalizeStrictList(source.crypto_sub_tags || source.cryptoSubTags, STRICT_CRYPTO_SUB_TAGS, 8);
  const aiSubTags = normalizeStrictList(source.ai_sub_tags || source.aiSubTags, STRICT_AI_SUB_TAGS, 8);
  const hotTags = normalizeHotTags(mergeListValues(source.hot_tags, source.hotTags, source.keywords), text, 12, keywordExclusions);
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

function buildTweetAnalysisPrompt(board, aiConfig, variables = {}) {
  const analysisPrompt = buildPromptInfo(board, aiConfig, PROMPT_FIELDS.TWEET_ANALYSIS, variables);
  return {
    prompt: analysisPrompt.prompt,
    analysisTemplate: analysisPrompt.template,
    promptTrace: {
      analysis: analysisPrompt.trace,
      length: analysisPrompt.prompt.length,
    },
  };
}

async function buildTweetAnalysisPromptPreview(board) {
  const aiConfig = await getBoardAiConfig(board);
  const project = buildProjectPromptName(board);
  const projectAliases = buildProjectPromptAliases(board, project);
  const keywordExclusions = buildKeywordExclusions(board);
  const variables = {
    text: "{{tweet_text}}",
    project,
    projectAliases,
    keywordExclusions,
    lang: "cn",
    words: aiConfig.summaryWords || 5,
    media: "{{media}}",
    createdAt: "{{tweet_created_at}}",
    referenceContext: "{{reference_context}}",
  };
  const { prompt, promptTrace, analysisTemplate } = buildTweetAnalysisPrompt(board, aiConfig, variables);
  return {
    systemPrompt: String(aiConfig.systemPrompt || "").trim() || "你是严格的 JSON 结构化分析助手。只输出符合 Schema 的 JSON。",
    userPrompt: prompt,
    template: analysisTemplate,
    variables,
    promptTrace,
    model: aiConfig.tweetAnalysisModel || aiConfig.model || "",
    maxTokens: aiConfig.tweetAnalysisMaxTokens || aiConfig.maxTokens || 1200,
    temperature: Number.isFinite(Number(aiConfig.temperature)) ? Number(aiConfig.temperature) : 0,
  };
}

async function callTweetAnalysisAi(board, post, options = {}) {
  const aiConfig = await getBoardAiConfig(board);
  const summaryWords = aiConfig.summaryWords || 5;
  const aiText = getPostAiText(post, options);
  const project = buildProjectPromptName(board);
  const projectAliases = buildProjectPromptAliases(board, project);
  const keywordExclusionValues = getKeywordExclusionValues(board);
  const keywordExclusions = keywordExclusionValues.join("、");
  const media = pickFirstMedia(post);
  const reference = options.reference || getPostReference(post, options.referenceRowsById || new Map(), {
    maxReferenceContextLength: options.maxReferenceContextLength,
    condensedTextsByTweetId: options.condensedTextsByTweetId,
    longTextModesByTweetId: options.longTextModesByTweetId,
  });
  const createdAt = post.postCreatedAt ? new Date(post.postCreatedAt).toISOString() : "";
  const promptText = aiText.condensed
    ? `长文精简版（基于当前原帖，仅保留核心内容）：${aiText.text}`
    : aiText.fallbackTruncated
      ? `长文截断版（精简调用失败，仅提供原文前段）：${aiText.text}`
      : aiText.text;
  const variables = {
    text: promptText,
    referenceContext: reference.context,
    project,
    projectAliases,
    keywordExclusions,
    lang: "cn",
    words: summaryWords,
    media,
    createdAt,
  };
  const { prompt, promptTrace } = buildTweetAnalysisPrompt(board, aiConfig, variables);
  if (!aiText.text) {
    return {
      tag: { topics: [], keywords: [], raw: {}, promptTrace: promptTrace.analysis },
      summary: { summaryZh: null, summaryEn: null, raw: {}, promptTrace: promptTrace.analysis },
      attitude: { score: 5, sentiment: SENTIMENTS.UNKNOWN, relevantToProject: null, confidence: null, summary: null, raw: {}, promptTrace: promptTrace.analysis },
      promptTrace,
      raw: {},
    };
  }
  const data = await generateTweetAnalysis({ prompt, aiConfig });
  const tag = extractTagResult(data, aiText.text, keywordExclusionValues);
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
    tag: { ...tag, promptTrace: promptTrace.analysis },
    summary: { ...summary, promptTrace: promptTrace.analysis },
    attitude: {
      score: data.score,
      sentiment: strictSentiment,
      relevantToProject: relevantToProject === undefined ? null : Boolean(relevantToProject),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      summary: data.attitude_summary || data.attitudeSummary || data.summary || null,
      raw: data,
      promptTrace: promptTrace.analysis,
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
  const force = Boolean(options.force);
  const postId = String(options.postId || "").trim();
  if (force && !postId) throw new Error("SOCIAL_LISTENING_REANALYZE_POST_ID_REQUIRED");
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
  const maxReferenceContextLength = clampInteger(options.maxReferenceContextLength || aiConfig.referenceContextMaxLength, 1200, 200, 2000);
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
  const postWhere = {
      boardId: board.id,
      text: { [Op.ne]: null },
      ...(force ? { id: postId } : { [Op.or]: pendingClauses }),
    };
  const posts = await EchohuntSocialListeningPost.findAll({
    where: applyRecallExcludeAuthorFilter(postWhere, board),
    order: [
      [getAiTextLengthOrder(), "ASC"],
      [getAiRankOrder(), "ASC"],
      ["viewsCount", "DESC"],
      ["postCreatedAt", "DESC"],
    ],
    limit,
  });
  const referenceRowsById = await loadReferenceRowsById(posts).catch((error) => {
    console.warn(`[SocialListeningAI] load reference context failed board=${board.id}:`, summarizeError(error));
    return new Map();
  });
  const longTextCondensation = await prepareLongTextCondensations(posts, referenceRowsById, aiConfig);

  const content = { enabled: contentEnabled, selected: 0, analyzed: 0, failed: 0, skipped: 0 };
  const attitude = { enabled: attitudeEnabled, selected: 0, analyzed: 0, failed: 0 };
  const startedAt = Date.now();
  const promptOverrides = hasPromptOverride(board, PROMPT_FIELDS.TWEET_ANALYSIS) ? 1 : 0;
  await runWithConcurrency(posts, concurrency, async (post) => {
    const itemStartedAt = Date.now();
    const aiText = getPostAiText(post, {
      maxTextLength,
      condensedTextsByTweetId: longTextCondensation.condensedTextsByTweetId,
      longTextModesByTweetId: longTextCondensation.longTextModesByTweetId,
    });
    const reference = getPostReference(post, referenceRowsById, {
      maxReferenceContextLength,
      condensedTextsByTweetId: longTextCondensation.condensedTextsByTweetId,
      longTextModesByTweetId: longTextCondensation.longTextModesByTweetId,
    });
    const shouldGenerateContent = contentEnabled && (force || isPendingContentPost(post));
    const shouldGenerateAttitude = attitudeEnabled && (force || isPendingAttitudePost(post));
    if (!shouldGenerateContent && !shouldGenerateAttitude) return;
    if (shouldGenerateContent) content.selected += 1;
    if (shouldGenerateAttitude) attitude.selected += 1;
    if (!aiText.text || (aiText.text.length < 8 && !reference.context)) {
      if (shouldGenerateContent) content.skipped += 1;
      await post.update({
        tagStatus: shouldGenerateContent && (post.tagStatus === "pending" || !post.tagStatus) ? "skipped" : post.tagStatus,
        summaryStatus: shouldGenerateContent && (post.summaryStatus === "pending" || !post.summaryStatus) ? "skipped" : post.summaryStatus,
        attitudeStatus: shouldGenerateAttitude && (post.attitudeStatus === "pending" || !post.attitudeStatus) ? "skipped" : post.attitudeStatus,
        aiStatus: "skipped",
      }).catch(() => null);
      console.log(`[SocialListeningAI] combined board=${board.id} post=${post.id} tweet=${post.tweetId} status=skipped ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} reference=${Boolean(reference.context)}`);
      return;
    }

    try {
      const result = await callTweetAnalysisAi(board, post, {
        maxTextLength,
        maxReferenceContextLength,
        referenceRowsById,
        reference,
        condensedTextsByTweetId: longTextCondensation.condensedTextsByTweetId,
        longTextModesByTweetId: longTextCondensation.longTextModesByTweetId,
      });
      const patch = {};
      const rawAi = { ...(post.rawTweet?.socialListeningAi || {}) };
      rawAi.longTextCondensation = {
        currentPost: aiText.condensed ? "condensed" : aiText.fallbackTruncated ? "truncated" : null,
        referenceCondensedCount: reference.condensedCount,
        referenceTruncatedCount: reference.fallbackTruncatedCount,
        threshold: longTextCondensation.threshold,
        maxLength: longTextCondensation.maxLength,
      };
      const shouldReplaceOldAiFields = force || post.aiSource === "dev_tweet_ai" || post.tagStatus === "reused" || post.summaryStatus === "reused";

      if (shouldGenerateContent) {
        const matchedKeywords = Array.isArray(post.rawTweet?.matchedKeywords) ? post.rawTweet.matchedKeywords : [];
        const keywordExclusions = getKeywordExclusionValues(board);
        if (shouldReplaceOldAiFields) patch.topics = result.tag.topics.length ? result.tag.topics : null;
        else if (result.tag.topics.length) patch.topics = mergeListValues(post.topics, result.tag.topics);
        if (shouldReplaceOldAiFields) patch.keywords = filterExcludedKeywords(mergeListValues(matchedKeywords, result.tag.keywords), keywordExclusions);
        else if (result.tag.keywords.length) patch.keywords = filterExcludedKeywords(mergeListValues(post.keywords, result.tag.keywords), keywordExclusions);
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
      console.log(`[SocialListeningAI] combined board=${board.id} post=${post.id} tweet=${post.tweetId} status=ok ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} condensed=${aiText.condensed} fallbackTruncated=${aiText.fallbackTruncated} truncated=${aiText.truncated} reference=${Boolean(reference.context)} referenceCondensed=${reference.condensedCount} referenceFallbackTruncated=${reference.fallbackTruncatedCount} content=${shouldGenerateContent} attitude=${shouldGenerateAttitude}`);
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
      console.warn(`[SocialListeningAI] combined board=${board.id} post=${post.id} tweet=${post.tweetId} status=failed ms=${Date.now() - itemStartedAt} textLen=${aiText.rawLength} truncated=${aiText.truncated} reference=${Boolean(reference.context)} content=${shouldGenerateContent} attitude=${shouldGenerateAttitude} error=${summarizeError(error)}`);
    }
  });

  const durationMs = Date.now() - startedAt;
  console.log(`[SocialListeningAI] combined batch board=${board.id} posts=${posts.length} references=${referenceRowsById.size} longText=${longTextCondensation.generated}/${longTextCondensation.candidates} cached=${longTextCondensation.cacheHits} longTextFailed=${longTextCondensation.failed} content=${content.analyzed}/${content.selected} contentFailed=${content.failed} attitude=${attitude.analyzed}/${attitude.selected} attitudeFailed=${attitude.failed} concurrency=${concurrency} maxTextLength=${maxTextLength} maxReferenceContextLength=${maxReferenceContextLength} ms=${durationMs}`);
  return {
    enabled: true,
    content,
    attitude,
    promptOverrides,
    selected: posts.length,
    referenceCount: referenceRowsById.size,
    longTextCondensation: {
      candidates: longTextCondensation.candidates,
      cacheHits: longTextCondensation.cacheHits,
      generated: longTextCondensation.generated,
      failed: longTextCondensation.failed,
      threshold: longTextCondensation.threshold,
      maxLength: longTextCondensation.maxLength,
    },
    concurrency,
    maxTextLength,
    maxReferenceContextLength,
    durationMs,
  };
}

async function reanalyzeSocialListeningPostAi(board, postId) {
  return analyzePendingPostAi(board, { postId, force: true, limit: 1, concurrency: 1 });
}

module.exports = {
  getBoardAiConfig,
  buildTweetAnalysisPromptPreview,
  scoreToSentiment,
  buildPromptTrace,
  analyzePendingPostAi,
  reanalyzeSocialListeningPostAi,
};
