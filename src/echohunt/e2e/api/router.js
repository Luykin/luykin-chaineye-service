const express = require("express");
const { authenticateAuthCenterToken } = require("../../../xhunt/auth-center/middleware/auth");
const {
  getActiveTweetIds,
  listE2eActivities,
  getE2eActivityDetail,
  registerE2eParticipant,
  createE2eCampaign,
  activateE2eCampaign,
} = require("../services/e2eService");
const { examineE2eTweet } = require("../services/e2eExamineService");

const router = express.Router();
const optionalAuth = authenticateAuthCenterToken({ optional: true });
const requiredAuth = authenticateAuthCenterToken();

function extractRequestAuthContext(req) {
  const identities = Array.isArray(req.authCenter?.identities) ? req.authCenter.identities : [];
  const twitterIdentity =
    identities.find((item) => item.provider === "twitter") || null;
  const evmIdentity =
    identities.find((item) => item.provider === "evm") || null;

  return {
    twitterIdentity,
    twitterId: twitterIdentity?.providerSubject ? String(twitterIdentity.providerSubject) : null,
    username: twitterIdentity?.username || null,
    displayName: twitterIdentity?.displayName || null,
    avatar: twitterIdentity?.avatar || null,
    evmAddress: evmIdentity?.walletAddress || evmIdentity?.providerSubject || null,
  };
}

// 1. 获取活跃 E2E 任务 tweet_id 列表（兼容 /active 与 /e2e_active）
async function handleGetActive(req, res) {
  try {
    const tweetIds = await getActiveTweetIds();
    return res.json(tweetIds);
  } catch (error) {
    console.error("[echohunt/e2e] getActiveTweetIds failed:", error);
    return res.status(500).json({ status: false, message: error.message || "Internal error" });
  }
}
router.get("/active", handleGetActive);
router.get("/e2e_active", handleGetActive);

// 2. 按状态分页获取 E2E 任务列表（兼容 /list、/tasks 与 /e2es）
async function handleListActivities(req, res) {
  try {
    const authCtx = extractRequestAuthContext(req);
    const userId = String(req.query?.user_id || authCtx.twitterId || "").trim() || null;
    const data = await listE2eActivities({
      userId,
      status: req.query?.status || "all",
      page: req.query?.page,
      pageSize: req.query?.pageSize ?? req.query?.page_size,
    });
    return res.json({ status: true, data });
  } catch (error) {
    console.error("[echohunt/e2e] listE2eActivities failed:", error);
    return res.status(error.status || 500).json({
      status: false,
      code: error.code || "E2E_LIST_FAILED",
      message: error.message || "Internal error",
    });
  }
}
router.get("/list", optionalAuth, handleListActivities);
router.get("/tasks", optionalAuth, handleListActivities);
router.get("/e2es", optionalAuth, handleListActivities);

// 3. 获取单个 E2E 任务详情与排行榜
router.get("/tasks/:id", optionalAuth, async (req, res) => {
  try {
    const authCtx = extractRequestAuthContext(req);
    const userId = String(req.query?.user_id || authCtx.twitterId || "").trim() || null;
    const item = await getE2eActivityDetail(req.params.id, { userId });
    if (!item) {
      return res.status(404).json({ status: false, message: "任务不存在" });
    }
    return res.json({ status: true, data: item });
  } catch (error) {
    console.error("[echohunt/e2e] getE2eActivityDetail failed:", error);
    return res.status(500).json({ status: false, message: error.message || "Internal error" });
  }
});

// 4. 校验推文是否可投放（兼容 /examine 与 /e2e_tweet_examine，支持传 tweet_url 或 tweet_id）
async function handleExamineTweet(req, res) {
  try {
    const authCtx = extractRequestAuthContext(req);
    const result = await examineE2eTweet({
      tweet_id: req.body?.tweet_id || req.body?.tweetId,
      tweet_url: req.body?.tweet_url || req.body?.tweetUrl,
      identity: authCtx.twitterIdentity,
      fallbackOwner: authCtx,
    });
    return res.json(result);
  } catch (error) {
    console.error("[echohunt/e2e] examineE2eTweet failed:", error);
    return res.status(500).json({ status: false, message: error.message || "Failed to examine tweet" });
  }
}
router.post("/examine", requiredAuth, express.json(), handleExamineTweet);
router.post("/e2e_tweet_examine", requiredAuth, express.json(), handleExamineTweet);

// 5. 预创建活动并获取外部支付订单（兼容 /create 与 /e2e/create）
async function handleCreateCampaign(req, res) {
  try {
    const authCtx = extractRequestAuthContext(req);
    const result = await createE2eCampaign(req.body || {}, {
      identity: authCtx.twitterIdentity,
      fallbackOwner: authCtx,
    });
    return res.json(result);
  } catch (error) {
    console.error("[echohunt/e2e] createE2eCampaign failed:", error);
    return res.status(error.status || 500).json({
      status: false,
      code: error.code || "E2E_CREATE_FAILED",
      message: error.message || "Failed to create campaign",
    });
  }
}
router.post("/create", requiredAuth, express.json(), handleCreateCampaign);
router.post("/e2e/create", requiredAuth, express.json(), handleCreateCampaign);

// 6. 通过外部支付接口校验到账并激活任务（兼容 /activate 与 /e2e/activate）
async function handleActivateCampaign(req, res) {
  try {
    const result = await activateE2eCampaign(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error("[echohunt/e2e] activateE2eCampaign failed:", error);
    return res.status(error.status || 500).json({
      status: false,
      code: error.code || "E2E_ACTIVATE_FAILED",
      message: error.message || "Failed to activate campaign",
    });
  }
}
router.post("/activate", requiredAuth, express.json(), handleActivateCampaign);
router.post("/e2e/activate", requiredAuth, express.json(), handleActivateCampaign);

// 7. 用户报名参与任务（兼容 /register 与 /e2e/register）
async function handleRegisterParticipant(req, res) {
  try {
    const authCtx = extractRequestAuthContext(req);
    const body = req.body || {};
    const result = await registerE2eParticipant({
      address: body.address || body.e2e_address,
      tweet_id: body.tweet_id || body.tweetId,
      user_id: authCtx.twitterId,
      user_address: authCtx.evmAddress,
      username: authCtx.username,
      name: authCtx.displayName,
      profile_image_url: authCtx.avatar,
    });
    return res.json(result);
  } catch (error) {
    console.error("[echohunt/e2e] registerE2eParticipant failed:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to register" });
  }
}
router.post("/register", requiredAuth, express.json(), handleRegisterParticipant);
router.post("/e2e/register", requiredAuth, express.json(), handleRegisterParticipant);

module.exports = router;
