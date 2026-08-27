const {
  GENERIC_PUBLIC_PROGRESS_EN,
  GENERIC_PUBLIC_PROGRESS_ZH,
  SENSITIVE_OUTPUT_PATTERNS,
} = require("./constants");
const { normalizeString, safeArray } = require("./utils");

function normalizeUiLang(...values) {
  for (const value of values) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) continue;
    if (text.startsWith("en")) return "en";
    if (text.startsWith("zh") || text === "cn" || text.includes("chinese") || text.includes("中文")) return "zh";
  }
  return "zh";
}

function isEnglishUi(lang) {
  return normalizeUiLang(lang) === "en";
}

function uiText(lang, zh, en) {
  return isEnglishUi(lang) ? en : zh;
}

function genericPublicProgress(lang = "zh") {
  return uiText(lang, GENERIC_PUBLIC_PROGRESS_ZH, GENERIC_PUBLIC_PROGRESS_EN);
}

function sanitizePublicText(value, maxLength = 500, lang = "zh") {
  const clean = normalizeString(value, maxLength + 80);
  if (!clean) return "";
  if (SENSITIVE_OUTPUT_PATTERNS.some((pattern) => pattern.test(clean))) {
    return genericPublicProgress(lang);
  }
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

function localizeProgressSources(sources = [], lang = "zh") {
  const sourceLabelsEn = {
    projectHandle: "Project handle",
    internal_twitter_user_lookup: "Internal Twitter user lookup",
    scope_gate: "Scope gate",
    projectBrief: "Project brief",
    strategy: "Search strategy",
    semanticQuery: "Semantic query",
    hardFilters: "Hard filters",
    normalizedFilters: "Normalized filters",
    pgvector: "Vector search",
    kol_marketing_profile: "KOL marketing profile",
    similarity: "Semantic similarity",
    rank: "Influence rank",
    followers: "Followers",
    willingness: "Collaboration willingness",
    quota: "Quota",
    results: "Results",
  };
  if (!isEnglishUi(lang)) return safeArray(sources || [], 6, 40);
  return safeArray(sources || [], 6, 80).map((source) => sourceLabelsEn[source] || source);
}

function searchProgressTitle(stage, lang) {
  if (stage === "embedding") return uiText(lang, "生成需求向量", "Generate requirement vector");
  if (stage === "db_search") return uiText(lang, "检索候选 KOL", "Retrieve candidate KOLs");
  return uiText(lang, "解析检索计划", "Parse retrieval plan");
}

function searchProgressMessage(event = {}, lang = "zh") {
  if (event.stage === "search_plan") {
    return event.status === "done"
      ? uiText(lang, "搜索语义和硬过滤条件已生成", "Search semantics and hard filters are ready.")
      : uiText(lang, "正在解析搜索语义和硬过滤条件", "Parsing search semantics and hard filters.");
  }
  if (event.stage === "embedding") {
    return event.status === "done"
      ? uiText(lang, "需求向量已生成", "Requirement vector is ready.")
      : uiText(lang, "正在生成需求向量", "Generating the requirement vector.");
  }
  if (event.stage === "db_search") {
    return event.status === "done"
      ? uiText(lang, "KOL 候选集检索完成", "KOL candidate retrieval is complete.")
      : uiText(lang, "正在检索 KOL 候选集", "Retrieving KOL candidates.");
  }
  return isEnglishUi(lang) ? "Processing the search stage." : (event.message || "正在处理搜索阶段。");
}

module.exports = {
  genericPublicProgress,
  isEnglishUi,
  localizeProgressSources,
  normalizeUiLang,
  sanitizePublicText,
  searchProgressMessage,
  searchProgressTitle,
  uiText,
};
