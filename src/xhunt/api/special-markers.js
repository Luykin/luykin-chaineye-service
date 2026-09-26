const express = require("express");
const { getFilteredPayloadForUser } = require("../services/specialMarkersCache");

const router = express.Router();

function setCacheHeaders(req, res, etag) {
  const quotedEtag = `"${etag}"`;
  res.set("ETag", quotedEtag);
  // 浏览器侧 5 分钟强缓存 + 过期后 60s stale-while-revalidate 协商
  // 必须按 x-tw-id 区分客户端缓存，避免不同权限用户共享本地缓存
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  res.set("Vary", "x-tw-id, Accept-Encoding");

  const ifNoneMatch = String(req.headers["if-none-match"] || "");
  return ifNoneMatch.split(",").map((item) => item.trim()).includes(quotedEtag);
}

/**
 * 一次性获取当前用户有权查看的所有特殊标记配置
 * 自动识别 req.headers['x-tw-id'] 执行权限过滤
 */
router.get(["/", "/all"], async (req, res) => {
  try {
    const reqTwid = req.headers["x-tw-id"] || req.user?.twitterId || "";
    const { payload, etag } = await getFilteredPayloadForUser(reqTwid);

    if (setCacheHeaders(req, res, etag)) {
      return res.status(304).end();
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error("[xhunt/special-markers] 获取标记失败:", error);
    res.status(500).json({ success: false, error: error.message || "获取标记失败" });
  }
});

module.exports = router;
