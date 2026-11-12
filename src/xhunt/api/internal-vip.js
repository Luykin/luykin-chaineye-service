const express = require("express");
const rateLimit = require("express-rate-limit");
const { XhuntVipApiCallLog } = require("../../models/postgres-start");
const vipMembershipService = require("../services/vipMembershipService");
const { requireVipServiceAuth, requireVipScope } = require("../middleware/vip-service-auth");

const router = express.Router();

function logValue(value, maxLength) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function actionFromPath(path) {
  if (path === "/grant") return "grant";
  if (path === "/batch-query") return "batch_query";
  if (path === "/force-expire") return "force_expire";
  return "unknown";
}

router.use((req, res, next) => {
  const startedAt = Date.now();
  res.locals.vipApiAction = actionFromPath(req.path);
  res.on("finish", () => {
    const body = req.body || {};
    const meta = res.locals.vipApiMeta || {};
    XhuntVipApiCallLog.create({
      clientKey: logValue(req.vipServiceClient?.clientKey || res.locals.vipApiClientKey, 64),
      requestId: logValue(req.vipServiceClient?.requestId || res.locals.vipApiRequestId, 128),
      orderNo: logValue(body.orderNo || body.requestNo, 128),
      action: res.locals.vipApiAction,
      twitterId: logValue(body.twitterId, 64),
      targetCount: Array.isArray(body.twitterIds) ? body.twitterIds.length : null,
      requestHash: meta.requestHash || null,
      httpStatus: res.statusCode,
      errorCode: res.locals.vipApiErrorCode || null,
      replayed: meta.replayed === true,
      durationMs: Date.now() - startedAt,
      createdAt: new Date(),
    }).catch((error) => {
      console.error("[vip-membership-api] failed to write call log:", error.message);
    });
  });
  next();
});

router.use(requireVipServiceAuth);
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.XHUNT_VIP_API_RATE_LIMIT_PER_MINUTE || "120", 10),
  keyGenerator: (req) => req.vipServiceClient.clientKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.locals.vipApiErrorCode = "RATE_LIMITED";
    res.status(429).json({ success: false, error: "RATE_LIMITED", message: "too many requests" });
  },
}));

function sendServiceError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const code = error.code || "VIP_MEMBERSHIP_INTERNAL_ERROR";
  if (error.requestHash) res.locals.vipApiMeta = { requestHash: error.requestHash, replayed: false };
  res.locals.vipApiErrorCode = code;
  if (status >= 500) console.error("[vip-membership-api] request failed:", error);
  const message = status >= 500 ? "internal server error" : (error.message || code);
  return res.status(status).json({ success: false, error: code, message });
}

router.post("/grant", requireVipScope("vip:grant"), async (req, res) => {
  try {
    const result = await vipMembershipService.grant({
      ...req.body,
      clientKey: req.vipServiceClient.clientKey,
      requestId: req.vipServiceClient.requestId,
    });
    res.locals.vipApiMeta = result.meta;
    return res.json({ success: true, data: result.data });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.post("/batch-query", requireVipScope("vip:read"), async (req, res) => {
  try {
    const data = await vipMembershipService.batchGet(req.body?.twitterIds);
    return res.json({ success: true, data });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.post("/force-expire", requireVipScope("vip:force-expire"), async (req, res) => {
  try {
    const result = await vipMembershipService.forceExpire({
      ...req.body,
      clientKey: req.vipServiceClient.clientKey,
      requestId: req.vipServiceClient.requestId,
    });
    res.locals.vipApiMeta = result.meta;
    return res.json({ success: true, data: result.data });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

module.exports = router;
