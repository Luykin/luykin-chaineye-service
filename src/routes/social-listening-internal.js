const express = require("express");
const { getCrawlerSupplementSearchKeywords } = require("../xhunt/social-listening/services/board-service");

const router = express.Router();

router.get("/crawler-supplement-keywords", async (_req, res) => {
  try {
    const data = await getCrawlerSupplementSearchKeywords();
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[social-listening-internal] 获取爬虫补充搜索关键词失败:", error);
    return res.status(500).json({
      success: false,
      error: "SOCIAL_LISTENING_KEYWORDS_FETCH_FAILED",
      message: "获取爬虫补充搜索关键词失败",
    });
  }
});

module.exports = router;
