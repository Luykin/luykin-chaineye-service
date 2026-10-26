const express = require("express");
const { authenticateAuthCenterToken } = require("../../../xhunt/auth-center/middleware/auth");
const {
  getActiveTweetIds,
  listE2eActivities,
  getE2eActivityDetail,
  verifyE2eAuthorFollow,
  registerE2eParticipant,
  createE2eCampaign,
  activateE2eCampaign,
} = require("../services/e2eService");
const { examineE2eTweet } = require("../services/e2eExamineService");
const { isInternalTestUserHandle } = require("../../../xhunt/constants/xhuntVip");
const {
  assertE2ePublishAccess,
  getE2ePublishAccessSummary,
} = require("../services/e2eAccessService");
const {
  getMyE2eInteractions,
  submitE2eInteraction,
} = require("../services/e2eInteractionSubmissionService");
const {
  enforceE2eInteractionSubmitCooldown,
} = require("../services/e2eInteractionRateLimit");

const router = express.Router();
const optionalAuth = authenticateAuthCenterToken({ optional: true });
const requiredAuth = authenticateAuthCenterToken();

function extractRequestAuthContext(req) {
  const identities = Array.isArray(req.authCenter?.identities) ? req.authCenter.identities : [];
  const twitterIdentity =
    identities.find((item) => item.provider === "twitter") || null;

  return {
    twitterIdentity,
    twitterId: twitterIdentity?.providerSubject ? String(twitterIdentity.providerSubject) : null,
    username: twitterIdentity?.username || null,
    displayName: twitterIdentity?.displayName || null,
    avatar: twitterIdentity?.avatar || null,
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
    const userId = authCtx.twitterId;
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

router.get("/access", requiredAuth, async (req, res) => {
  try {
    return res.json({ status: true, data: await getE2ePublishAccessSummary(req.authCenter) });
  } catch (error) {
    return res.status(error.status || 500).json({
      status: false,
      code: error.code || "E2E_PUBLISH_ACCESS_FAILED",
      message: error.message || "查询 E2E 投放权限失败",
    });
  }
});

// 3. 获取单个 E2E 任务详情与排行榜
router.get("/tasks/:id", optionalAuth, async (req, res) => {
  try {
    const authCtx = extractRequestAuthContext(req);
    const userId = authCtx.twitterId;
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
    await assertE2ePublishAccess(req.authCenter);
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
    return res.status(error.status || 500).json({
      status: false,
      code: error.code || "E2E_EXAMINE_FAILED",
      message: error.message || "Failed to examine tweet",
    });
  }
}
router.post("/examine", requiredAuth, express.json(), handleExamineTweet);
router.post("/e2e_tweet_examine", requiredAuth, express.json(), handleExamineTweet);

// 5. 预创建活动并获取外部支付订单（兼容 /create 与 /e2e/create）
async function handleCreateCampaign(req, res) {
  try {
    await assertE2ePublishAccess(req.authCenter);
    const authCtx = extractRequestAuthContext(req);
    const isInternalTestUser = [authCtx.twitterId, authCtx.username]
      .filter(Boolean)
      .some(isInternalTestUserHandle);
    const result = await createE2eCampaign(req.body || {}, {
      identity: authCtx.twitterIdentity,
      fallbackOwner: authCtx,
      isInternalTestUser,
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

function sendE2eRegistrationError(res, error, fallbackCode) {
  const code = error.code || (error.status ? error.message : null) || fallbackCode;
  const response = res.status(error.status || 500);
  if (Number(error.retryAfterSeconds) > 0) {
    response.set("Retry-After", String(Math.ceil(Number(error.retryAfterSeconds))));
  }
  return response.json({
    success: false,
    error: code,
    code,
    message: error.publicMessage || (error.status ? error.message : "Failed to process registration"),
    ...(Number(error.retryAfterSeconds) > 0
      ? { retryAfterSeconds: Math.ceil(Number(error.retryAfterSeconds)) }
      : {}),
  });
}

// 7. 实时校验当前用户是否关注了目标推文的真实作者
router.post("/tasks/:id/verify-follow", requiredAuth, express.json(), async (req, res) => {
  try {
    const authCtx = extractRequestAuthContext(req);
    const verified = await verifyE2eAuthorFollow(req.params.id, {
      identity: authCtx.twitterIdentity,
      twitterUserId: authCtx.twitterId,
      redisClient: req.redisClient,
    });
    return res.json({ success: true, verified: true, data: verified });
  } catch (error) {
    console.error("[echohunt/e2e] verifyE2eAuthorFollow failed:", error);
    return sendE2eRegistrationError(res, error, "E2E_FOLLOW_VERIFY_FAILED");
  }
});

// 8. 用户报名参与任务（兼容 /register 与 /e2e/register）
async function handleRegisterParticipant(req, res) {
  try {
    const authCtx = extractRequestAuthContext(req);
    const body = req.body || {};
    const result = await registerE2eParticipant({
      address: body.address || body.e2e_address,
      tweet_id: body.tweet_id || body.tweetId,
      user_id: authCtx.twitterId,
      user_address: body.user_address || body.userAddress || body.evmAddress,
      username: authCtx.username,
      name: authCtx.displayName,
      profile_image_url: authCtx.avatar,
    }, {
      identity: authCtx.twitterIdentity,
      redisClient: req.redisClient,
    });
    return res.json(result);
  } catch (error) {
    console.error("[echohunt/e2e] registerE2eParticipant failed:", error);
    return sendE2eRegistrationError(res, error, "E2E_REGISTER_FAILED");
  }
}
router.post("/register", requiredAuth, express.json(), handleRegisterParticipant);
router.post("/e2e/register", requiredAuth, express.json(), handleRegisterParticipant);

// 9. 用户主动提交本人发布的评论或引用链接，后端实时验证作者和目标推文关系
router.post("/tasks/:id/interactions", requiredAuth, express.json(), async (req, res) => {
  try {
    const authCtx = extractRequestAuthContext(req);
    await enforceE2eInteractionSubmitCooldown(req.redisClient, authCtx.twitterId);
    const data = await submitE2eInteraction({
      address: req.body?.address,
      campaignTweetId: req.params.id,
      tweetUrl: req.body?.tweet_url || req.body?.tweetUrl,
      twitterUserId: authCtx.twitterId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[echohunt/e2e] submit interaction failed:", error);
    return sendE2eRegistrationError(res, error, "E2E_INTERACTION_SUBMIT_FAILED");
  }
});

// 10. 仅返回当前登录用户在指定活动批次中的互动提交
router.get("/tasks/:id/interactions/me", requiredAuth, async (req, res) => {
  try {
    const authCtx = extractRequestAuthContext(req);
    const data = await getMyE2eInteractions({
      address: req.query?.address,
      campaignTweetId: req.params.id,
      twitterUserId: authCtx.twitterId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[echohunt/e2e] get my interactions failed:", error);
    return sendE2eRegistrationError(res, error, "E2E_INTERACTION_LIST_FAILED");
  }
});

module.exports = router;
