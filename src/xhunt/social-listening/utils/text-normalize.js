const HTML_ENTITY_MAP = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
});

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity || "").toLowerCase();
    if (key[0] === "#") {
      const isHex = key[1] === "x";
      const codePoint = parseInt(isHex ? key.slice(2) : key.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch (_) {
          return match;
        }
      }
    }
    return HTML_ENTITY_MAP[key] || match;
  });
}

function stripEmoji(value) {
  return String(value || "").replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ");
}

function normalizeTweetText(value, options = {}) {
  const removeMentions = options.removeMentions === true;
  let text = decodeHtmlEntities(value);
  text = text.replace(/https?:\/\/t\.co\/\S+/gi, " ");
  text = text.replace(/https?:\/\/\S+/gi, " ");
  if (removeMentions) text = text.replace(/@[a-zA-Z0-9_]{1,30}/g, " ");
  text = stripEmoji(text);
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function normalizeKeywords(values = []) {
  const output = [];
  const seen = new Set();
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const keyword = String(value || "").trim();
    if (!keyword) return;
    const normalized = keyword.replace(/^@+/, "").toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(keyword.replace(/^@+/, ""));
  });
  return output.slice(0, 50);
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordMatchesText(text, keyword) {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedKeyword = String(keyword || "").trim().replace(/^@+/, "").toLowerCase();
  if (!normalizedText || !normalizedKeyword) return false;
  if (hasCjk(normalizedKeyword)) return normalizedText.includes(normalizedKeyword);
  return new RegExp(`(^|[^a-z0-9_])${escapeRegExp(normalizedKeyword)}([^a-z0-9_]|$)`, "i").test(normalizedText);
}

function collectMatchedKeywords(text, keywords = []) {
  return normalizeKeywords(keywords).filter((keyword) => keywordMatchesText(text, keyword));
}

module.exports = {
  decodeHtmlEntities,
  normalizeTweetText,
  normalizeKeywords,
  keywordMatchesText,
  collectMatchedKeywords,
};
