const DEFAULT_MAX_LENGTH = 80;

function splitGraphemes(value) {
  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

function buildTweetDisplayTitle(text, maxLength = DEFAULT_MAX_LENGTH) {
  if (typeof text !== "string") return null;
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!firstLine) return null;

  const graphemes = splitGraphemes(firstLine);
  if (graphemes.length <= maxLength) return firstLine;
  return `${graphemes.slice(0, maxLength).join("")}…`;
}

module.exports = {
  buildTweetDisplayTitle,
};
