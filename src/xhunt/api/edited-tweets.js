const express = require("express");
const { query } = require("express-validator");
const { authenticateTokenOptional } = require("../middleware/auth");
const { aiContentRateLimit } = require("../middleware/aiContentRateLimit");
const { validateRequest } = require("../middleware/validate-request");
const {
  requestEditedTweetData,
  EditedTweetServiceError,
} = require("../services/edited-tweet-service");
const { applyEditedTweetAccess } = require("../utils/edited-tweet-access");

const router = express.Router();
const TWITTER_ID_PATTERN = /^\d+$/;

function setNoStoreHeaders(_req, res, next) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

function rejectTargetSelection(req, res, next) {
  const blockedParams = ["target", "url", "path"].filter(
    (key) => req.query[key] !== undefined
  );
  if (blockedParams.length > 0) {
    return res.status(400).json({
      code: 400,
      message: "Unsupported query parameter",
      error: "EDITED_TWEET_UNSUPPORTED_TARGET",
    });
  }
  next();
}

function isValidTwitterIdList(value) {
  if (Array.isArray(value)) return false;
  const ids = String(value || "")
    .split(",")
    .map((item) => item.trim());
  return (
    ids.length >= 1 &&
    ids.length <= 100 &&
    ids.every(Boolean) &&
    ids.every((id) => TWITTER_ID_PATTERN.test(id))
  );
}

function getRequestId(req) {
  return req.requestId || req.headers["x-request-id"] || undefined;
}

function handleEditedTweetError(req, res, error) {
  const requestId = getRequestId(req);
  const statusCode =
    error instanceof EditedTweetServiceError ? error.statusCode : 502;
  const errorCode =
    error instanceof EditedTweetServiceError
      ? error.code
      : "EDITED_TWEET_INVALID_UPSTREAM_RESPONSE";

  console.warn("[EditedTweets] request failed", {
    path: req.path,
    statusCode,
    errorCode,
    requestId,
    message: error.message,
  });

  return res.status(statusCode).json({
    code: statusCode,
    message:
      statusCode === 400
        ? error.message
        : statusCode === 504
          ? "Edited tweet service timed out"
          : "Edited tweet service unavailable",
    error: errorCode,
    ...(requestId ? { request_id: requestId } : {}),
  });
}

router.use(setNoStoreHeaders, authenticateTokenOptional, aiContentRateLimit);

router.get(
  "/edited-counts",
  rejectTargetSelection,
  [
    query("user_ids")
      .exists({ checkFalsy: true })
      .withMessage("user_ids is required")
      .custom(isValidTwitterIdList)
      .withMessage("user_ids must contain 1 to 100 Twitter IDs"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const data = await requestEditedTweetData("counts", {
        user_ids: req.query.user_ids,
      });
      const filtered = applyEditedTweetAccess(req, data, {
        endpoint: "counts",
      });
      return res.status(200).json(filtered);
    } catch (error) {
      return handleEditedTweetError(req, res, error);
    }
  }
);

router.get(
  "/edited",
  rejectTargetSelection,
  [
    query("user_id")
      .exists({ checkFalsy: true })
      .withMessage("user_id is required")
      .matches(TWITTER_ID_PATTERN)
      .withMessage("user_id must be a Twitter ID"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("limit must be between 1 and 50")
      .toInt(),
    query("offset")
      .optional()
      .isInt({ min: 0 })
      .withMessage("offset must be a non-negative integer")
      .toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const data = await requestEditedTweetData("details", {
        user_id: req.query.user_id,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      const filtered = applyEditedTweetAccess(req, data, {
        endpoint: "details",
      });
      return res.status(200).json(filtered);
    } catch (error) {
      return handleEditedTweetError(req, res, error);
    }
  }
);

module.exports = router;
