const db = require("../models");

function getHeader(req, name) {
  const v = req.get(name);
  if (v) return v;
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || null;
}

function jsonError(res, status, error, message) {
  return res.status(status).json({
    success: false,
    error,
    message: message || error,
  });
}

function proApiKeyAuth(cost = 2) {
  const creditsCost = Number.isFinite(Number(cost)) ? Number(cost) : 2;

  return async (req, res, next) => {
    try {
      const apiKey = getHeader(req, "pro-api-key");
      if (!apiKey) {
        return jsonError(res, 401, "MISSING_API_KEY", "Missing required header: pro-api-key");
      }

      if (!db?.ApiKey) {
        return jsonError(res, 500, "API_KEY_MODEL_NOT_READY", "ApiKey model is not loaded");
      }

      const row = await db.ApiKey.findOne({ where: { key: apiKey } });
      if (!row) {
        return jsonError(res, 403, "INVALID_API_KEY", "Invalid pro-api-key");
      }

      const now = new Date();
      if (row.status !== "active") {
        return jsonError(res, 403, "API_KEY_DISABLED", "API key is disabled");
      }

      if (row.expires_at && now >= new Date(row.expires_at)) {
        return jsonError(res, 410, "API_KEY_EXPIRED", "API key has expired");
      }

      // cost=0 的接口只做鉴权，不扣费
      if (creditsCost > 0) {
        const remaining = Number(row.credits_remaining ?? 0);
        if (!Number.isFinite(remaining) || remaining < creditsCost) {
          return jsonError(res, 402, "INSUFFICIENT_CREDITS", "Insufficient credits");
        }

        const [affected] = await db.ApiKey.update(
          {
            credits_remaining: db.Sequelize.literal(
              `GREATEST(credits_remaining - ${creditsCost}, 0)`
            ),
            last_used_at: now,
          },
          {
            where: {
              id: row.id,
              status: "active",
              ...(row.expires_at
                ? { expires_at: { [db.Sequelize.Op.gt]: now } }
                : {}),
              credits_remaining: { [db.Sequelize.Op.gte]: creditsCost },
            },
          }
        );

        if (affected !== 1) {
          return jsonError(
            res,
            402,
            "INSUFFICIENT_CREDITS",
            "Insufficient credits or key state changed, please retry"
          );
        }
      }

      req.proApiKey = {
        id: row.id,
        key: row.key,
        remark: row.remark,
        creditsCost,
      };

      return next();
    } catch (e) {
      return jsonError(res, 500, "API_KEY_AUTH_ERROR", e?.message || String(e));
    }
  };
}

module.exports = { proApiKeyAuth };
