const express = require("express");
const axios = require("axios");
const { adminAuth, requirePermission } = require("../../../admin/middleware/adminAuth");

const router = express.Router();
const LOOKUP_PERMISSION = "twitter-id-handler";
const TWITTER_USER_LOOKUP_URL = "https://data.cryptohunt.ai/fetch/twitter/user";

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .trim();
}

function normalizeTwitterId(value) {
  return String(value || "").trim();
}

function normalizeProfile(payload) {
  const source = payload?.data?.data || payload?.data?.user || payload?.data || payload?.user || payload?.result || payload;
  if (!source || typeof source !== "object") return null;
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const handler = normalizeHandle(
    source.username || source.username_raw || source.handle || source.screen_name || profile.username || profile.username_raw
  );
  const twitterId = normalizeTwitterId(source.id || source.twitterId || source.twitter_id || source.userId || profile.id);
  if (!handler || !twitterId) return null;
  return {
    twitterId,
    handler,
    displayName: String(source.name || source.displayName || source.display_name || profile.name || handler).trim() || handler,
    avatar: source.avatar || source.profile_image_url || source.profileImageUrl || profile.profile_image_url || null,
    source: "twitter-profile-api",
  };
}

async function queryTwitterProfile(params) {
  const response = await axios.get(TWITTER_USER_LOOKUP_URL, { params, timeout: 8000 });
  return normalizeProfile(response.data);
}

router.get(
  "/twitter-id-handler-lookup",
  adminAuth,
  requirePermission(LOOKUP_PERMISSION),
  async (req, res) => {
    const rawTwitterId = normalizeTwitterId(req.query.twitterId);
    const rawHandler = normalizeHandle(req.query.handler);

    if ((rawTwitterId && rawHandler) || (!rawTwitterId && !rawHandler)) {
      return res.status(400).json({ success: false, error: "请传入 Twitter ID 或 handler（二选一）" });
    }
    if (rawTwitterId && !/^\d{1,30}$/.test(rawTwitterId)) {
      return res.status(400).json({ success: false, error: "Twitter ID 必须是数字" });
    }
    if (rawHandler && !/^[A-Za-z0-9_]{1,128}$/.test(rawHandler)) {
      return res.status(400).json({ success: false, error: "handler 格式不正确" });
    }

    try {
      const profile = rawTwitterId
        ? await queryTwitterProfile({ user_id: rawTwitterId })
        : await queryTwitterProfile({ username: rawHandler });
      const result = profile;

      if (!result) {
        return res.status(404).json({ success: false, error: "未找到对应的 Twitter 账号" });
      }

      return res.json({
        success: true,
        data: {
          ...result,
          handler: normalizeHandle(result.handler),
          twitterId: normalizeTwitterId(result.twitterId),
          twitterUrl: `https://x.com/${normalizeHandle(result.handler)}`,
        },
      });
    } catch (error) {
      if (error.response?.status === 404) {
        return res.status(404).json({ success: false, error: "未找到对应的 Twitter 账号" });
      }
      console.error("[twitter-id-handler-lookup] 查询失败:", error.message);
      return res.status(502).json({ success: false, error: "Twitter 账号服务暂时不可用，请稍后重试" });
    }
  }
);

router.queryTwitterProfile = queryTwitterProfile;
router.normalizeProfile = normalizeProfile;
module.exports = router;
module.exports.queryTwitterProfile = queryTwitterProfile;
module.exports.normalizeProfile = normalizeProfile;
