/**
 * Resolve XHunt request language exclusively from x-language.
 * Query parameters take precedence over headers so callers can explicitly
 * choose a language for a single request.
 */
function resolveXLanguage(req = {}) {
  const candidate = req.query?.["x-language"] || req.headers?.["x-language"];
  if (candidate && String(candidate).trim().toLowerCase().startsWith("en")) {
    return "en";
  }
  return "zh";
}

module.exports = { resolveXLanguage };
