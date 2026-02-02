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

function resolveCost(cost, req) {
  if (typeof cost === "function") {
    const v = cost(req);
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(cost);
  return Number.isFinite(n) ? n : NaN;
}

function proApiKeyAuth(cost = 2) {
  return async (req, res, next) => {
    let creditsCost = resolveCost(cost, req);
    if (!Number.isFinite(creditsCost)) creditsCost = 2;

    try {
      const apiKey = getHeader(req, "pro-api-key");
      if (!apiKey) {
        return jsonError(res, 401, "MISSING_API_KEY", "Missing required header: pro-api-key");
      }

      // 特殊测试/内置 Key：无限额度，不查库、不扣费
      if (apiKey === "rk_666666888888666666LUYKIN") {
        req.proApiKey = {
          id: null,
          key: apiKey,
          creditsCost: 0,
          unlimited: true,
        };
        return next();
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
      // cost>0 的接口：这里只做余额检查，不立即扣费；扣费放到响应结束且为 2xx 时执行
      if (creditsCost > 0) {
        const remaining = Number(row.credits_remaining ?? 0);
        if (!Number.isFinite(remaining) || remaining < creditsCost) {
          return jsonError(res, 402, "INSUFFICIENT_CREDITS", "Insufficient credits");
        }
      }

      req.proApiKey = {
        id: row.id,
        key: row.key,
        creditsCost,
      };

      // 延迟扣费：仅当最终 HTTP 状态码是 2xx 才扣费
      if (creditsCost > 0) {
        let charged = false;

        res.on("finish", async () => {
          if (charged) return;
          charged = true;

          if (res.statusCode < 200 || res.statusCode >= 300) return;

          try {
            const endNow = new Date();
            await db.ApiKey.update(
              {
                credits_remaining: db.Sequelize.literal(
                  `GREATEST(credits_remaining - ${creditsCost}, 0)`
                ),
                last_used_at: endNow,
              },
              {
                where: {
                  id: row.id,
                  status: "active",
                  ...(row.expires_at
                    ? { expires_at: { [db.Sequelize.Op.gt]: endNow } }
                    : {}),
                  credits_remaining: { [db.Sequelize.Op.gte]: creditsCost },
                },
              }
            );
          } catch (e) {
            console.error("[rootdatapro] API key post-charge error", e);
          }
        });
      }

      return next();
    } catch (e) {
      return jsonError(res, 500, "API_KEY_AUTH_ERROR", e?.message || String(e));
    }
  };
}

module.exports = { proApiKeyAuth };
