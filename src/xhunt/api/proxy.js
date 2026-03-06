const express = require("express");
const { securityMiddleware } = require("../middleware/security");
const {
  authenticateToken,
  authenticateTokenOptional,
} = require("../middleware/auth");
const { aiContentRateLimit } = require("../middleware/aiContentRateLimit");
const { checkProStatus } = require("../middleware/pro-status");
const { applyProDataFiltering } = require("../utils/pro-data-filtering");
const { isRequestXHuntVip } = require("../constants/xhuntVip");
const { XHuntUser, DailyActiveUser } = require("../../models/postgres-start");
const { Sequelize } = require("sequelize");
const { getRedisClient } = require("../../lib/redisClient");

const router = express.Router();

// URL映射配置
const URL_MAPPINGS = {
  kota: "https://kota.chaineye.tools",
  kb: "http://127.0.0.1:8087",
  kota_temporary: "http://172.31.0.8:16531",
  k8s_kota: "https://data.cryptohunt.ai",
};

// 默认目标服务器
const DEFAULT_TARGET = "kota";

// 积分赠送 API 配置
const ADD_CREDITS_API_URL = "https://data.cryptohunt.ai/pro/admin/user/addCredits";

/**
 * 计算用户应赠送的积分
 * @param {string} username - 用户用户名（twitter username）
 * @returns {Promise<number>} - 计算后的积分
 */
async function calculateGiftCredits(username) {
  try {
    // 1. 基础额度
    const baseCredits = 200;

    // 2. 查询用户过去30天登录天数
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const activeDaysCount = await DailyActiveUser.count({
      where: {
        userId: username,
        date: {
          [Sequelize.Op.gte]: thirtyDaysAgo.toISOString().split('T')[0],
        },
      },
    });

    // 登录奖励：每天50，上限800
    const loginBonus = Math.min(activeDaysCount * 50, 800);

    // 3. 查询用户排名
    const user = await XHuntUser.findOne({
      where: { username },
      attributes: ['kolRank20W'],
    });

    const kolRank = user?.kolRank20W;

    // 排名奖励（三档互斥，取最高档）
    let rankBonus = 0;
    if (kolRank && kolRank <= 10000) {
      rankBonus = 1000; // 前1万
    } else if (kolRank && kolRank <= 50000) {
      rankBonus = 600;  // 前5万
    } else if (kolRank && kolRank <= 100000) {
      rankBonus = 200;  // 前10万
    }

    // 总积分 = 基础 + 登录奖励 + 排名奖励
    const totalCredits = baseCredits + loginBonus + rankBonus;

    console.log(`[GiftCredits] User: ${username}, Base: ${baseCredits}, LoginDays: ${activeDaysCount}, LoginBonus: ${loginBonus}, Rank: ${kolRank || 'N/A'}, RankBonus: ${rankBonus}, Total: ${totalCredits}`);

    return totalCredits;
  } catch (error) {
    console.error(`[GiftCredits] Error calculating credits for ${username}:`, error);
    // 出错时返回基础额度
    return 200;
  }
}

/**
 * 调用积分赠送接口
 * @param {Object} params - 参数对象
 * @param {string} params.address - 用户钱包地址
 * @param {string} params.tx - 交易标识（x-user-id + x-request-id）
 * @param {number} params.credits - 积分数量
 */
async function callAddCreditsApi({ address, tx, credits }) {
  try {
    const response = await fetch(ADD_CREDITS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "admin": "cuegod_shuai",
      },
      body: JSON.stringify({
        address,
        tx,
        credits,
        operation: "gift",
      }),
    });

    // 仅状态码 200 视为成功
    if (response.status !== 200) {
      const errorText = await response.text();
      console.error(`[GiftCredits] API error: ${response.status} ${response.statusText}`, errorText);
      return false;
    }

    console.log(`[GiftCredits] Successfully added ${credits} credits to ${address}`);
    return true;
  } catch (error) {
    console.error(`[GiftCredits] API call failed:`, error);
    return false;
  }
}

/**
 * 获取用户积分赠送的 Redis Key
 * @param {string} userId - 用户ID（Twitter用户名）
 * @returns {string} - Redis Key
 */
function getGiftCreditsKey(userId) {
  return `gift:credits:user:${userId}`;
}

/**
 * 检查用户是否已赠送过积分（使用Redis SET NX实现幂等性）
 * 以userId为维度，一旦赠送过，无论换什么EVM地址都不再赠送
 * 
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>} - true表示已赠送过（应跳过），false表示未赠送过
 */
async function checkAndMarkGiftCredits(userId) {
  const redisKey = getGiftCreditsKey(userId);
  const redisClient = await getRedisClient();
  
  // 使用 SET NX（Only set the key if it does not already exist）
  // 返回 'OK' 表示设置成功（之前不存在），返回 null 表示已存在
  const result = await redisClient.set(redisKey, "1", {
    NX: true, // Only if Not eXists
  });
  
  // result === 'OK' 表示这是第一次设置，未赠送过
  // result === null 表示key已存在，已赠送过
  const alreadyGifted = result === null;
  
  if (alreadyGifted) {
    console.log(`[GiftCredits] Skip: user ${userId} has already received gift credits`);
  } else {
    console.log(`[GiftCredits] Mark: user ${userId} marked as gifted (permanent)`);
  }
  
  return alreadyGifted;
}

/**
 * 处理用户创建后的积分赠送
 * 当请求是 POST /pro/admin/user/create 且成功时，自动计算并赠送积分
 * 注意：此操作会同步等待积分赠送完成后再返回，但赠送失败不会影响原请求
 * 
 * 防重逻辑：
 * 1. 以 userId（Twitter用户名）为维度做终身防重
 * 2. 一旦某个用户赠送过，无论换什么EVM地址都不再赠送
 * 3. 使用Redis SET NX原子操作实现幂等性，Key永久存储
 * 
 * @param {Object} req - Express 请求对象
 * @param {string} targetUrl - 目标服务器 URL
 * @param {boolean} isSuccess - 原请求是否成功（2xx）
 */
async function handleUserCreateGiftCredits(req, targetUrl, isSuccess) {
  // 仅处理成功的 POST /pro/admin/user/create 请求
  const isUserCreateEndpoint = targetUrl.includes("/pro/admin/user/create");
  const isPostMethod = req.method === "POST";
  
  if (!isSuccess || !isUserCreateEndpoint || !isPostMethod) {
    return;
  }

  try {
    const address = req.body?.address;
    const userId = req.headers["x-user-id"] || "";
    const requestId = req.headers["x-request-id"] || "";
    const username = userId;
    
    if (!address || !username) {
      console.log("[GiftCredits] Skip: missing address or username");
      return;
    }

    // 1. 先尝试绑定地址（无论是否已赠送过积分，新地址都应该绑定）
    // 如果用户没有绑定地址，就把申请的地址绑定给这个用户
    // 但如果该地址已被其他用户绑定，则不能绑定
    try {
      const user = await XHuntUser.findOne({ where: { username } });
      if (user) {
        const normalizedAddress = address.toLowerCase().trim();
        const addresses = Array.isArray(user.evmAddresses) ? user.evmAddresses : [];
        const normalizedAddresses = addresses.map(a => String(a || '').trim().toLowerCase());
        
        if (addresses.length < 3 && !normalizedAddresses.includes(normalizedAddress)) {
          // 检查该地址是否已被其他用户绑定
          const conflicts = await XHuntUser.sequelize.query(
            `
            SELECT u.id, u.username
            FROM "XHuntUsers" u
            WHERE u.id != :userId
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(u."evmAddresses"::jsonb, '[]'::jsonb)) AS a(elem)
                WHERE LOWER(a.elem) = :address
              )
            LIMIT 1
            `,
            {
              replacements: { userId: user.id, address: normalizedAddress },
              type: Sequelize.QueryTypes.SELECT,
            }
          );

          if (conflicts.length === 0) {
            // 地址未被其他用户绑定，可以绑定
            addresses.push(address);
            await user.update({ evmAddresses: addresses });
            console.log(`[GiftCredits] Bound address ${address} to user ${username}`);
          } else {
            console.log(`[GiftCredits] Address ${address} already bound to other user: ${conflicts[0].username}, skip binding`);
          }
        }
      }
    } catch (bindError) {
      // 绑定失败不影响积分赠送，只记录日志
      console.error('[GiftCredits] Error binding address:', bindError.message);
    }

    // 2. 防重检查：检查该用户是否已赠送过（终身仅一次）
    const alreadyGifted = await checkAndMarkGiftCredits(username);
    if (alreadyGifted) {
      console.log(`[GiftCredits] Skip: user ${username} has already received gift credits, but address binding processed`);
      return;
    }

    // 3. 同步计算并赠送积分（等待完成后再返回）
    const credits = await calculateGiftCredits(username);
    const tx = `${userId}${requestId}`;

    await callAddCreditsApi({ address, tx, credits });
    
    console.log(`[GiftCredits] Success: user ${username} received ${credits} credits to ${address}`);
  } catch (giftError) {
    // 积分赠送失败不应影响原请求，但需要考虑是否清除标记以便下次重试
    // 这里选择保留标记，避免重复赠送的风险，可手动处理失败情况
    console.error("[GiftCredits] Error in gift credits flow:", giftError);
  }
}

// 确保所有响应都包含 CORS 头（无论状态码是多少）
const ensureCorsHeaders = (req, res, allowMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS") => {
  const requestOrigin = req.headers.origin;

  // 设置 Access-Control-Allow-Origin
  res.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");

  // 设置 Access-Control-Allow-Credentials（如果尚未设置）
  if (!res.hasHeader("Access-Control-Allow-Credentials")) {
    res.setHeader("Access-Control-Allow-Credentials", "false");
  }

  // 设置 Access-Control-Allow-Methods（如果尚未设置）
  if (!res.hasHeader("Access-Control-Allow-Methods")) {
    res.setHeader("Access-Control-Allow-Methods", allowMethods);
  }

  // 设置 Access-Control-Allow-Headers（如果尚未设置）
  if (!res.hasHeader("Access-Control-Allow-Headers")) {
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-ID, X-Request-Timestamp, X-Device-Fingerprint, X-Request-Signature, X-Extension-Version, X-User-ID, X-Window-Location-Href"
    );
  }
};

// 代理请求处理函数
async function proxyRequest(req, res, targetUrl) {
  try {
    // 需要保留的 header 列表（忽略大小写，支持部分匹配）
    const HEADERS_TO_PRESERVE = [
      // 认证相关
      "admin",
    ];

    // 构建请求选项
    const headers = {
      "Content-Type": "application/json",
    };

    // 保留原始请求头中匹配的字段（忽略大小写）
    for (const [key, value] of Object.entries(req.headers || {})) {
      const lowerKey = key.toLowerCase();
      const shouldPreserve = HEADERS_TO_PRESERVE.some((pattern) =>
        lowerKey.includes(pattern.toLowerCase())
      );
      if (shouldPreserve) {
        headers[key] = value;
      }
    }

    const options = {
      method: req.method,
      headers,
    };

    // 如果有请求体，添加到选项中
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    // 发送请求到目标服务器
    const response = await fetch(targetUrl, options);

    // 检查响应状态码和内容类型
    const statusCode = response.status;
    const isSuccess = statusCode >= 200 && statusCode < 300;
    const isRedirect = statusCode >= 300 && statusCode < 400;
    const isError = statusCode >= 400;
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    // 先读取响应文本（无论成功还是失败都需要）
    let responseText;
    try {
      responseText = await response.text();
    } catch (readError) {
      console.error("读取响应体失败:", {
        url: targetUrl,
        method: req.method,
        status: statusCode,
        error: readError.message,
      });
      ensureCorsHeaders(req, res);
      return res.status(statusCode || 500).json({
        error: response.statusText || "请求失败",
        details: `无法读取服务器响应: ${readError.message}`,
      });
    }

    // 处理重定向状态码（300-399）
    if (isRedirect) {
      const location = response.headers.get("Location");
      console.log(`目标服务器返回重定向: ${statusCode} ${response.statusText}`, {
        url: targetUrl,
        method: req.method,
        status: statusCode,
        statusText: response.statusText,
        redirectLocation: location,
      });

      // 对于重定向，可以选择：
      // 1. 将重定向信息传递给客户端（当前实现）
      // 2. 或者自动跟随重定向（需要在 fetch 选项中设置 redirect: 'follow'，这是默认行为）
      // 注意：fetch 默认会自动跟随重定向，所以如果能看到 301，说明设置了 redirect: 'manual'
      
      // 如果重定向响应是 JSON 格式，尝试解析
      let redirectData;
      if (isJson) {
        try {
          redirectData = JSON.parse(responseText);
        } catch {
          redirectData = {
            redirect: true,
            status: statusCode,
            statusText: response.statusText,
            location: location,
            message: responseText || `资源已重定向`,
          };
        }
      } else {
        redirectData = {
          redirect: true,
          status: statusCode,
          statusText: response.statusText,
          location: location,
          message: responseText || `资源已重定向`,
        };
      }

      // 设置 CORS 头
      ensureCorsHeaders(req, res);

      // 设置 Location 响应头
      if (location) {
        res.setHeader("Location", location);
      }

      return res.status(statusCode).json(redirectData);
    }

    // 对于错误状态码（400+），打印详细的错误信息
    if (isError) {
      console.error(
        `目标服务器返回错误: ${statusCode} ${response.statusText}`,
        {
          url: targetUrl,
          method: req.method,
          status: statusCode,
          statusText: response.statusText,
          contentType: contentType,
          errorBody: responseText.substring(0, 2000), // 打印前 2000 字符，包含完整错误信息
        }
      );

      // 尝试解析为 JSON，如果失败则返回错误文本
      let errorData;
      if (isJson) {
        try {
          errorData = JSON.parse(responseText);
        } catch {
          // JSON 声明但解析失败，使用原始文本
          errorData = {
            error: response.statusText || "请求失败",
            details: responseText || `服务器返回了 ${statusCode} 状态码`,
          };
        }
      } else {
        // 非 JSON 响应（如 HTML 错误页面），构造错误响应对象
        errorData = {
          error: response.statusText || "请求失败",
          details: responseText || `服务器返回了 ${statusCode} 状态码`,
        };
      }

      // 设置 CORS 头
      ensureCorsHeaders(req, res);

      return res.status(statusCode).json(errorData);
    }

    // 处理成功响应（200-299）
    // 设置 CORS 头
    ensureCorsHeaders(req, res);

    // 设置浏览器缓存策略
    setBrowserCacheHeaders(res, req.method);

    // 处理用户创建后的积分赠送（同步等待完成）
    await handleUserCreateGiftCredits(req, targetUrl, isSuccess);

    if (isJson) {
      // JSON 响应：解析并返回
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (jsonError) {
        console.error("JSON parse error:", {
          url: targetUrl,
          method: req.method,
          error: jsonError.message,
          rawResponse: responseText.substring(0, 1000), // 打印前 1000 字符
        });
        return res.status(502).json({
          error: "目标服务器返回了无效的JSON数据",
          details: "服务器响应格式错误",
        });
      }

      // Pro 用户数据裁切逻辑（统一管理）
      // 针对非 Pro 用户进行数据过滤
      try {
        data = applyProDataFiltering(req, data);
      } catch (filterErr) {
        console.warn("Pro data filtering warning:", filterErr);
      }

      // 返回 JSON 响应
      return res.status(statusCode).json(data);
    } else {
      // 非JSON响应，但状态码正常：原样返回
      // 记录日志但不报错
      console.log("Non-JSON response (status OK):", {
        url: targetUrl,
        method: req.method,
        status: statusCode,
        contentType: contentType,
        responseLength: responseText.length,
      });

      // 设置原始响应头
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }

      // 原样返回响应文本
      return res.status(statusCode).send(responseText);
    }
  } catch (error) {
    console.error("Proxy request error:", {
      url: targetUrl,
      method: req.method,
      error: error.message,
      stack: error.stack,
    });
    ensureCorsHeaders(req, res);
    res.status(500).json({ error: "请求失败" });
  }
}

// 设置浏览器缓存头
function setBrowserCacheHeaders(res, method) {
  if (method === "GET") {
    // GET 请求设置10分钟缓存
    res.setHeader("Cache-Control", "public, max-age=600"); // 600秒 = 10分钟
    res.setHeader(
      "Expires",
      new Date(Date.now() + 10 * 60 * 1000).toUTCString()
    );
  } else {
    // 非 GET 请求不缓存
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}

// 获取目标URL
function getTargetUrl(req) {
  // 提取并删除 target 参数
  const originalQuery = { ...req.query };
  const target = originalQuery.target || DEFAULT_TARGET;
  delete originalQuery.target;

  let baseUrl = (URL_MAPPINGS[target] || URL_MAPPINGS[DEFAULT_TARGET]).trim();

  // 提取路径（去除 /auth/ 或 /public/ 前缀）
  const targetPath = req.path.replace(/^\/(auth|public)\//, "");

  // 将剩余查询参数转换为查询字符串
  const search = new URLSearchParams(originalQuery).toString();

  // 拼接完整的目标 URL
  let fullPath = targetPath;
  if (search) {
    fullPath += `?${search}`;
  }
  return `${baseUrl}/${fullPath}`;
}

// 获取目标URL（流式专用：去除 public-stream 前缀）
function getTargetUrlForStreaming(req) {
  // 提取并删除 target 参数
  const originalQuery = { ...req.query };
  const target = originalQuery.target || DEFAULT_TARGET;
  delete originalQuery.target;

  let baseUrl = (URL_MAPPINGS[target] || URL_MAPPINGS[DEFAULT_TARGET]).trim();

  // 提取路径（去除 /auth/ 或 /public-stream/ 前缀）
  const targetPath = req.path.replace(/^\/(auth|public-stream)\//, "");

  // 将剩余查询参数转换为查询字符串
  const search = new URLSearchParams(originalQuery).toString();

  // 拼接完整的目标 URL
  let fullPath = targetPath;
  if (search) {
    fullPath += `?${search}`;
  }
  return `${baseUrl}/${fullPath}`;
}

// 流式代理请求处理函数
async function proxyRequestStream(req, res, targetUrl) {
  try {
    // 禁用 Express 的响应缓冲
    res.setTimeout(0);
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲

    const options = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      },
    };

    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);

    // 检查流式响应的状态
    if (!response.ok) {
      console.error(
        targetUrl,
        "Streaming request failed:",
        response.status,
        response.statusText
      );
      try {
        const errorText = await response.text();
        console.error(
          targetUrl,
          "Error response:",
          errorText.substring(0, 500)
        );
      } catch (_) {}
      ensureCorsHeaders(req, res);
      return res.status(response.status).json({
        error: "流式请求失败",
        details: `目标服务器返回错误: ${response.status} ${response.statusText}`,
      });
    }

    await handleStreamingResponse(response, res, req);
  } catch (error) {
    console.error(targetUrl, "Proxy stream request error:", error);
    try {
      ensureCorsHeaders(req, res);
      res.status(500).json({ error: "流式请求失败" });
    } catch (_) {}
  }
}

// 处理流式响应的函数
async function handleStreamingResponse(response, res, req) {
  try {
    // 设置 CORS 头
    ensureCorsHeaders(req, res);

    // 设置流式响应的头部
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲

    // 设置状态码
    res.status(response.status);

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // 解码数据块
          const chunk = decoder.decode(value, { stream: true });

          // 直接写入，不添加额外的前缀
          res.write(chunk);

          // 强制刷新缓冲区，确保数据立即发送
          if (typeof res.flush === "function") {
            res.flush();
          }
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } else {
      // 如果没有 body 流，尝试使用 response.text() 然后分块发送
      const text = await response.text();
      const chunks = text.split("\n");

      for (const chunk of chunks) {
        if (chunk.trim()) {
          res.write(chunk + "\n");
          // 强制刷新缓冲区
          if (typeof res.flush === "function") {
            res.flush();
          }
        }
      }
      res.end();
    }
  } catch (error) {
    console.error("Streaming response error:", error);
    try {
      // 注意：如果响应已经开始发送，设置 CORS 头可能会失败，但不影响功能
      if (req && res && !res.headersSent) {
        ensureCorsHeaders(req, res);
      }
      res.status(500).json({ error: "流式响应处理失败" });
    } catch (_) {}
  }
}

// 代理路由 - 需要认证
router.all(
  "/auth/*",
  authenticateToken,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 删帖接口（需要 Pro 状态检查）
router.all(
  "/public/fetch/tweet/deleted",
  authenticateTokenOptional,
  checkProStatus,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 账户profile接口（需要 Pro 状态检查）
router.all(
  "/public/fetch/twitter/user",
  authenticateTokenOptional,
  checkProStatus,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 特殊接口访问控制（仅 XHunt VIP 允许返回真实数据）
router.all(
  "/public/fetch/twitter/unfollow_relation",
  authenticateTokenOptional,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    try {
      const ret = isRequestXHuntVip(req);
      if (!ret) {
        // 非 内部用户 返回空数据
        ensureCorsHeaders(req, res);
        return res.status(200).json({ data: [], isVip: false });
      }
    } catch (_) {}

    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 无需认证（但特定路径可选择性识别用户）
router.all(
  "/public/*",
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 流式（与普通代理完全分离）
router.all("/public-stream/*", securityMiddleware, async (req, res) => {
  const targetUrl = getTargetUrlForStreaming(req);
  await proxyRequestStream(req, res, targetUrl);
});

module.exports = router;
