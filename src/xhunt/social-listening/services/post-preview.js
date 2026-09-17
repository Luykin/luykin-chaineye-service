const PREVIEW_MAX_LENGTH = 1000;
const MAX_PREVIEW_IMAGES = 4;
const TWITTER_IMAGE_HOSTS = new Set(["pbs.twimg.com", "abs.twimg.com"]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url : null;
  } catch (_) {
    return null;
  }
}

function isSafeImageUrl(value) {
  const url = isSafeHttpUrl(value);
  return url && TWITTER_IMAGE_HOSTS.has(url.hostname.toLowerCase()) ? url.toString() : null;
}

function truncateUnicode(value, maxLength = PREVIEW_MAX_LENGTH) {
  const characters = Array.from(String(value || ""));
  const truncated = characters.length > maxLength;
  return {
    text: `${characters.slice(0, maxLength).join("")}${truncated ? "…" : ""}`,
    truncated,
    originalLength: characters.length,
  };
}

function linkifyText(value) {
  const text = String(value || "");
  const pattern = /https?:\/\/[^\s<>"'`]+/gi;
  let cursor = 0;
  let result = "";
  let match;
  while ((match = pattern.exec(text))) {
    result += escapeHtml(text.slice(cursor, match.index));
    const safeUrl = isSafeHttpUrl(match[0]);
    result += safeUrl
      ? `<a href="${escapeHtml(safeUrl.toString())}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(match[0])}</a>`
      : escapeHtml(match[0]);
    cursor = match.index + match[0].length;
  }
  result += escapeHtml(text.slice(cursor));
  return result.replace(/\r?\n/g, "<br>");
}

function collectImageUrls(value, output = [], seen = new Set()) {
  if (!value || output.length >= MAX_PREVIEW_IMAGES) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, output, seen));
    return output;
  }
  if (typeof value !== "object") return output;

  const record = value;
  const type = String(record.type || record.media_type || record.kind || "").toLowerCase();
  if (type.includes("video") || type.includes("gif")) return output;
  ["media_url_https", "media_url", "image_url", "imageUrl", "preview_image_url", "url"].forEach((key) => {
    const url = isSafeImageUrl(record[key]);
    if (url && !seen.has(url) && output.length < MAX_PREVIEW_IMAGES) {
      seen.add(url);
      output.push(url);
    }
  });
  Object.values(record).forEach((item) => collectImageUrls(item, output, seen));
  return output;
}

function buildPostPreview(text, rawTweet = {}) {
  const preview = truncateUnicode(text);
  const images = collectImageUrls(rawTweet?.info || rawTweet?.media || {});
  const imageHtml = images.map((url) => `<img src="${escapeHtml(url)}" alt="" loading="lazy">`).join("");
  return {
    text: preview.text,
    html: `<p>${linkifyText(preview.text)}</p>${imageHtml}`,
    truncated: preview.truncated,
    originalLength: preview.originalLength,
    images,
  };
}

module.exports = {
  buildPostPreview,
  truncateUnicode,
};
