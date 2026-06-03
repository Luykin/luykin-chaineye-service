const express = require("express");
const { getCachedPayload } = require("../services/userTagsCache");

const router = express.Router();

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function extractTwitterIdFromRequestId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/(?:^|-)twid(\d+)(?:$|[^\d])/i);
  return match ? match[1] : "";
}

function setCacheHeaders(req, res, etag) {
  const quotedEtag = `"${etag}"`;
  res.set("ETag", quotedEtag);
  // 浏览器侧 5 分钟绝对缓存：有效期内不请求后端；过期后再用 ETag 协商。
  // 服务端数据由 Redis 长缓存承接，管理后台更新时主动刷新 Redis。
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  res.set("Vary", "Accept-Encoding");

  const ifNoneMatch = String(req.headers["if-none-match"] || "");
  return ifNoneMatch.split(",").map((item) => item.trim()).includes(quotedEtag);
}

// 一次性返回全部标签配置。数据量不大，前端本地按 twitterId / username 匹配。
router.get(["/", "/all"], async (req, res) => {
  try {
    const payload = await getCachedPayload();
    if (setCacheHeaders(req, res, payload.etag)) {
      return res.status(304).end();
    }

    const { etag, ...data } = payload;
    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[xhunt/tags] 查询失败:", error);
    res.status(500).json({ success: false, error: error.message || "查询标签失败" });
  }
});

// 兼容调试用单用户查询：仍然基于一次性缓存数据查询，不直接查库。
router.get("/lookup", async (req, res) => {
  try {
    const payload = await getCachedPayload();
    if (setCacheHeaders(req, res, payload.etag)) {
      return res.status(304).end();
    }

    const twitterId = String(
      req.query.twitterId || extractTwitterIdFromRequestId(req.headers["x-request-id"]) || ""
    ).trim();
    const username = normalizeUsername(req.query.username || req.headers["x-user-id"]);

    let data = null;
    let matchedBy = null;

    if (twitterId && payload.byTwitterId[twitterId]) {
      data = { twitterId, ...payload.byTwitterId[twitterId] };
      matchedBy = "twitterId";
    } else if (username && payload.byUsername[username]) {
      data = { username, ...payload.byUsername[username] };
      matchedBy = "username";
    }

    res.json({ success: true, data, matchedBy, version: payload.version });
  } catch (error) {
    console.error("[xhunt/tags/lookup] 查询失败:", error);
    res.status(500).json({ success: false, error: error.message || "查询标签失败" });
  }
});

module.exports = router;
