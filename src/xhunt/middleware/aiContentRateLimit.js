// AI 内容生成频率限制中间件 检查推文是不是ai生成
const AI_CONTENT_RATE_LIMIT_FLAG = Symbol.for("xhunt.aiContentRateLimitExecuted");

// AI 内容生成白名单
// - 200次/日名单（保留）
const AI_CONTENT_WHITELIST_200 = ["luoyukun4", "alpha_gege"];
// - 20次/日名单：使用全局 XHunt VIP 名单
const { isRequestXHuntVip } = require("../constants/xhuntVip");

// 获取到明天00:00的秒数
function getSecondsUntilMidnight(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.ceil((tomorrow - beijingTime) / 1000);
}

// 获取明天00:00的时间戳
function getNextDayResetTime(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

// AI 内容生成频率限制中间件
async function aiContentRateLimit(req, res, next) {
  try {
    // 只对 /pro/api/ai/content 的 POST 请求进行限制
    const applies = req.method === "POST" && req.path.includes("/pro/api/ai/content");
    if (!applies) {
      return next();
    }

    // 幂等保护：防止重复执行导致计数重复
    if (req[AI_CONTENT_RATE_LIMIT_FLAG]) {
      return next();
    }
    req[AI_CONTENT_RATE_LIMIT_FLAG] = true;

    const xUserId = String(req.headers["x-user-id"]).toLocaleLowerCase();
    if (!xUserId) {
      return res.status(400).json({
        error:
          "Unable to identify user identity, please refresh the page and try again",
      });
    }

    // 判断白名单等级：先判200次，再判20次
    const isWhitelist200 = AI_CONTENT_WHITELIST_200.some((id) => {
      return (
        String(xUserId).toLocaleLowerCase() === String(id).toLocaleLowerCase()
      );
    });
    const isWhitelist20 = !isWhitelist200 && isRequestXHuntVip(req);

    // 获取用户标识
    let userKey;
    if (req.user && req.user.id) {
      // 已登录用户：使用用户ID作为key
      userKey = `ai_content_limit:user:${req.user.id}`;
    } else if (req.securityContext && req.securityContext.fingerprint) {
      // 未登录用户：使用指纹作为key
      userKey = `ai_content_limit:fingerprint:${req.securityContext.fingerprint}`;
    } else {
      // 无法识别用户，拒绝请求
      return res.status(400).json({
        error:
          "Unable to identify user identity, please refresh the page and try again",
      });
    }

    // 获取今天的日期作为过期时间计算基准
    const now = new Date();
    const beijingTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );
    const today = beijingTime.toISOString().split("T")[0];
    const dailyKey = `${userKey}:${today}`;

    // 检查今日调用次数
    const currentCount = (await req.redisClient.get(dailyKey)) || 0;
    const maxCalls = isWhitelist200 ? 200 : isWhitelist20 ? 20 : 3; // 200/20/3 次

    if (parseInt(currentCount) >= maxCalls) {
      return res.status(429).json({
        error: `已使用 ${currentCount}/${maxCalls} 次，请明天再试`,
        message: `今日已使用 ${currentCount}/${maxCalls} 次，请明天再试 (You have used ${currentCount}/${maxCalls} times today, please try again tomorrow)`,
        resetTime: getNextDayResetTime(beijingTime),
      });
    }

    // 增加调用次数
    const newCount = await req.redisClient.incr(dailyKey);

    // 设置过期时间到明天00:00（北京时间）
    if (newCount === 1) {
      const secondsUntilMidnight = getSecondsUntilMidnight(beijingTime);
      await req.redisClient.expire(dailyKey, secondsUntilMidnight);
    }

    // 在响应头中添加使用情况信息
    res.setHeader("X-RateLimit-Limit", maxCalls);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxCalls - newCount));
    res.setHeader("X-RateLimit-Reset", getNextDayResetTime(beijingTime));

    next();
  } catch (error) {
    console.error("AI content rate limit error:", error);
    // 发生错误时不阻止请求，但记录日志
    next();
  }
}

module.exports = {
  aiContentRateLimit,
};
