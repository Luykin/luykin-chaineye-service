const DEFAULT_INTERACTION_SUBMIT_COOLDOWN_MS = 6000;

function getInteractionSubmitCooldownMs() {
  const configured = Number(process.env.E2E_INTERACTION_SUBMIT_COOLDOWN_MS);
  if (!Number.isFinite(configured) || configured < 1000 || configured > 60000) {
    return DEFAULT_INTERACTION_SUBMIT_COOLDOWN_MS;
  }
  return Math.floor(configured);
}

function rateLimitError(code, status, message, retryAfterSeconds = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.publicMessage = message;
  if (retryAfterSeconds) error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

async function enforceE2eInteractionSubmitCooldown(redisClient, twitterUserId) {
  const userId = String(twitterUserId || "").trim();
  if (!userId) return;
  if (!redisClient?.set) {
    throw rateLimitError(
      "E2E_INTERACTION_RATE_LIMIT_UNAVAILABLE",
      503,
      "互动提交服务暂不可用，请稍后重试"
    );
  }

  const cooldownMs = getInteractionSubmitCooldownMs();
  const key = `echohunt:e2e:interaction-submit:v1:${userId}`;
  let acquired;
  try {
    acquired = await redisClient.set(key, "1", { NX: true, PX: cooldownMs });
  } catch (_) {
    throw rateLimitError(
      "E2E_INTERACTION_RATE_LIMIT_UNAVAILABLE",
      503,
      "互动提交服务暂不可用，请稍后重试"
    );
  }
  if (acquired) return;

  let remainingMs = cooldownMs;
  if (typeof redisClient.pTTL === "function") {
    try {
      const ttl = Number(await redisClient.pTTL(key));
      if (Number.isFinite(ttl) && ttl > 0) remainingMs = ttl;
    } catch (_) {
      // TTL 仅用于改善提示；读取失败时使用完整冷却时间。
    }
  }
  const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  throw rateLimitError(
    "E2E_INTERACTION_RATE_LIMITED",
    429,
    `提交过于频繁，请 ${retryAfterSeconds} 秒后重试`,
    retryAfterSeconds
  );
}

module.exports = {
  DEFAULT_INTERACTION_SUBMIT_COOLDOWN_MS,
  enforceE2eInteractionSubmitCooldown,
  getInteractionSubmitCooldownMs,
};
