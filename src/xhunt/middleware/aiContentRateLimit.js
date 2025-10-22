// AI 内容生成频率限制中间件 检查推文是不是ai生成

// AI 内容生成白名单
// - 200次/日名单
const AI_CONTENT_WHITELIST_200 = ["luoyukun4", "alpha_gege"];
// - 20次/日名单
const AI_CONTENT_WHITELIST_20 = [
  "cuegod001",
  "maid_crypto",
  "Paris13Jeanne",
  "momochenming",
  "Mimoo1201",
  "vvickym2",
  "web3annie",
  "charles48011843",
  "bocaibocai_",
  "Meta8Mate",
  "zohanlin",
  "qqzsss",
  "0xAllen888",
  "NeohexWu",
  "ScarlettWeb3",
  "AirdropAlchemis",
  "timbro_bro",
  "blockTVBee",
  "0xMoon6626",
  "captain_kent",
  "border_crypto",
  "DRbitcoin36",
  "bclaobai",
  "love_doge123",
  "0xcryptoHowe",
  "Monica_xiaoM",
  "aiSunny224737",
  "Cyrus_G3",
  "0xJuliechen",
  "chaozuoye",
  "unaiyang",
  "VireGeek",
  "Ru7Longcrypto",
  "EleveResearch",
  "0xjasonli",
  "dabiaogeggg",
  "KuiGas",
  "tmel0211",
  "Rocky_Bitcoin",
  "BTW0205",
  "fishkiller",
  "Alvin0617",
  "0xBeyondLee",
  "CryptoPainter_X",
  "0x_Todd",
  "Luyaoyuan1",
  "CandyDAO_leaf",
  "Web3Feng",
  "jason_chen998",
  "Wuhuoqiu",
  "sea_bitcoin",
  "BroLeonAus",
  "Guomin184935",
  "0x_xifeng",
  "Baili1018",
  "qklxsqf",
  "crypto_pumpman",
  "Crypto_He",
  "yueya_eth",
  "wang_xiaolou",
  "xingpt",
  "wenxue600",
  "Airdrop_Guard",
  "Jay21871836",
  "egyptk6",
  "Joensmoon",
  "MEJ50749",
  "guiguziben",
  "xingxingjun8888",
  "taowang1",
  "btcpiggy",
  "liushezhang",
  "WWTLitee",
];

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
    if (req.method !== "POST" || !req.path.includes("/pro/api/ai/content")) {
      return next();
    }

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
    const isWhitelist20 =
      !isWhitelist200 &&
      AI_CONTENT_WHITELIST_20.some((id) => {
        return (
          String(xUserId).toLocaleLowerCase() === String(id).toLocaleLowerCase()
        );
      });

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
