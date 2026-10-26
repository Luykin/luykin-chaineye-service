function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function matchesLanguage(text, lang) {
  const normalizedLang = String(lang || "all").toLowerCase();
  if (!normalizedLang || normalizedLang === "all") return true;
  const isCn = hasChinese(text);
  if (normalizedLang === "cn" || normalizedLang === "zh") return isCn;
  if (normalizedLang === "en") return !isCn && /[a-zA-Z]/.test(String(text || ""));
  return true;
}

function getLanguageExclusionReason(text, lang) {
  const normalizedLang = String(lang || "all").toLowerCase();
  if (matchesLanguage(text, normalizedLang)) return null;
  return normalizedLang === "en" ? "活动仅统计英文互动" : "活动仅统计中文互动";
}

module.exports = {
  getLanguageExclusionReason,
  matchesLanguage,
};
