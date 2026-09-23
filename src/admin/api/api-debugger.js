/**
 * 管理后台 - 接口调试工具 (API Debugger)
 *
 * 核心目标：
 * - 允许管理员在管理后台直接调试后端依赖接口（本次支持 src/xhunt/api/ghost-following.js 相关接口）
 * - 代码中写死或配置的参数（如 PRO_API_CONFIG.apiKey、Crawler Pool、默认 offset 等）由后台自动沿用注入
 * - 管理员只需输入动态参数（如 handle、user_id、cursor 等）
 * - 所有请求均由管理后台服务器发出，支持真实调用内网/受保护下游服务，记录请求细节、响应体与耗时
 */

const express = require("express");
const axios = require("axios");
const { createAdminWriteAudit } = require("../services/admin-audit");
const ghostFollowingRouter = require("../../xhunt/api/ghost-following");

const router = express.Router();

// 审计日志：记录调试接口执行记录
router.use(
  createAdminWriteAudit((req) => (
    req.method === "POST" && req.path === "/execute" ? "api-debugger-execute" : null
  ))
);

// 获取同源配置
const PRO_API_CONFIG = ghostFollowingRouter.PRO_API_CONFIG || {
  baseUrl: process.env.PRO_API_BASE_URL || "http://172.31.0.2:3001",
  apiKey: process.env.PRO_API_KEY || "bd1cbd94-20e5-42a2-96cd-e4313ea2154d",
};

const CRAWLER_QUOTA_CONFIG = ghostFollowingRouter.CRAWLER_QUOTA_CONFIG || {
  url:
    process.env.GHOST_FOLLOWING_CRAWLER_QUOTA_URL ||
    "http://172.31.0.2:3001/api/crawler/quota-current?endpoint=user_tweets",
  apiKey:
    process.env.GHOST_FOLLOWING_CRAWLER_QUOTA_API_KEY ||
    PRO_API_CONFIG.apiKey,
  minRemaining:
    parseInt(process.env.GHOST_FOLLOWING_CRAWLER_MIN_QUOTA, 10) || 200,
  timeoutMs: 3000,
};

function maskSecret(val) {
  if (!val || typeof val !== "string") return "";
  if (val.length <= 8) return "***";
  return `${val.slice(0, 4)}***${val.slice(-4)}`;
}

function cleanHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .trim();
}

function cleanUserId(value) {
  return String(value || "").trim();
}

// 接口注册表
const ENDPOINTS = [
  {
    id: "ghost_crawler_quota",
    name: "爬虫额度检查",
    module: "Ghost Following",
    method: "GET",
    path: "/api/crawler/quota-current",
    defaultBaseUrl: PRO_API_CONFIG.baseUrl,
    description: "检查当前爬虫节点剩余额度及配额状态，返回指定 endpoint 的调用余量。",
    presetHeaders: {
      "X-API-KEY": `${maskSecret(CRAWLER_QUOTA_CONFIG.apiKey)} (代码已预置)`,
    },
    fixedParams: {},
    fields: [
      {
        key: "endpoint",
        label: "接口名称 (endpoint)",
        type: "string",
        required: true,
        defaultValue: "user_tweets",
        placeholder: "例如 user_tweets, kol_tweets, following",
        description: "需要查询配额的接口 endpoint 名称",
        options: ["user_tweets", "kol_tweets", "following"],
      },
    ],
    sampleParams: {
      endpoint: "user_tweets",
    },
  },
  {
    id: "ghost_kol_tweets",
    name: "获取 KOL 最新推文 (First API: kol_tweets)",
    module: "Ghost Following",
    method: "POST",
    path: "/tweet/kol_tweets",
    defaultBaseUrl: PRO_API_CONFIG.baseUrl,
    description: "Ghost Following 分析第 1 步：优先根据博主 handle 抓取最新推文。代码中沿用 offset:0、verbose:false。",
    presetHeaders: {
      "X-API-KEY": `${maskSecret(PRO_API_CONFIG.apiKey)} (代码已预置)`,
      "X-Crawler-Pool": "general (代码已预置)",
      "Content-Type": "application/json",
    },
    fixedParams: {
      offset: 0,
      verbose: false,
    },
    fields: [
      {
        key: "handle",
        label: "Twitter 用户名 (handle)",
        type: "string",
        required: true,
        defaultValue: "elonmusk",
        placeholder: "例如 elonmusk 或 @elonmusk",
        description: "博主用户名，系统会自动去除开头的 @ 符号与 URL 前缀",
      },
      {
        key: "offset",
        label: "偏移量 (offset)",
        type: "number",
        required: false,
        defaultValue: 0,
        placeholder: "默认 0",
        description: "推文分页偏移量，默认 0",
      },
      {
        key: "verbose",
        label: "详细模式 (verbose)",
        type: "boolean",
        required: false,
        defaultValue: false,
        description: "是否返回详细模式推文信息，默认 false",
      },
    ],
    sampleParams: {
      handle: "elonmusk",
      offset: 0,
      verbose: false,
    },
  },
  {
    id: "ghost_user_tweets",
    name: "获取用户推文 (Second API: user_tweets)",
    module: "Ghost Following",
    method: "POST",
    path: "/tweet/user_tweets",
    defaultBaseUrl: PRO_API_CONFIG.baseUrl,
    description: "Ghost Following 分析第 2 步（降级备用）：当 First API 查无推文时，使用用户数字 user_id 抓取推文。",
    presetHeaders: {
      "X-API-KEY": `${maskSecret(PRO_API_CONFIG.apiKey)} (代码已预置)`,
      "X-Crawler-Pool": "general (代码已预置)",
      "Content-Type": "application/json",
    },
    fixedParams: {},
    fields: [
      {
        key: "user_id",
        label: "Twitter 数字 ID (user_id)",
        type: "string",
        required: true,
        defaultValue: "44196397",
        placeholder: "例如 44196397 (纯数字 ID)",
        description: "Twitter 用户纯数字 ID",
      },
    ],
    sampleParams: {
      user_id: "44196397",
    },
  },
  {
    id: "ghost_profile_by_userid",
    name: "用户资料与锁推检测 (Third API: profile_by_userid)",
    module: "Ghost Following",
    method: "POST",
    path: "/user/profile_by_userid",
    defaultBaseUrl: PRO_API_CONFIG.baseUrl,
    description: "Ghost Following 分析第 3 步：当第一和第二接口均无推文时，检查账号是否设为受保护/私密（锁推）及粉丝数信息。",
    presetHeaders: {
      "X-API-KEY": `${maskSecret(PRO_API_CONFIG.apiKey)} (代码已预置)`,
      "X-Crawler-Pool": "general (代码已预置)",
      "Content-Type": "application/json",
    },
    fixedParams: {},
    fields: [
      {
        key: "user_id",
        label: "Twitter 数字 ID (user_id)",
        type: "string",
        required: true,
        defaultValue: "44196397",
        placeholder: "例如 44196397",
        description: "Twitter 用户纯数字 ID",
      },
    ],
    sampleParams: {
      user_id: "44196397",
    },
  },
  {
    id: "ghost_social_following",
    name: "获取关注列表 (Following API: social/following)",
    module: "Ghost Following",
    method: "POST",
    path: "/social/following",
    defaultBaseUrl: PRO_API_CONFIG.baseUrl,
    description: "抓取指定 Twitter 用户正在关注的账号列表，支持 cursor 分页游标。",
    presetHeaders: {
      "X-API-KEY": `${maskSecret(PRO_API_CONFIG.apiKey)} (代码已预置)`,
      "X-Crawler-Pool": "general (代码已预置)",
      "Content-Type": "application/json",
    },
    fixedParams: {},
    fields: [
      {
        key: "user_id",
        label: "Twitter 数字 ID (user_id)",
        type: "string",
        required: true,
        defaultValue: "44196397",
        placeholder: "例如 44196397",
        description: "Twitter 用户纯数字 ID",
      },
      {
        key: "cursor",
        label: "分页游标 (cursor)",
        type: "string",
        required: false,
        defaultValue: "",
        placeholder: "选填，首次查询留空",
        description: "翻页 cursor 游标，首次请求传空字符串",
      },
    ],
    sampleParams: {
      user_id: "44196397",
      cursor: "",
    },
  },
  {
    id: "ghost_full_pipeline",
    name: "幽灵关注完整分析流 (端到端降级诊断)",
    module: "Ghost Following",
    method: "POST",
    path: "/simulation/analyze-pipeline",
    defaultBaseUrl: PRO_API_CONFIG.baseUrl,
    description: "由管理后台后端串联执行完整分析逻辑：First API(kol_tweets) -> 降级 Second API(user_tweets) -> 降级 Third API(profile 锁推判断)，诊断决策走向与各步耗时。",
    presetHeaders: {
      "X-API-KEY": `${maskSecret(PRO_API_CONFIG.apiKey)} (代码已预置)`,
      "X-Crawler-Pool": "general (代码已预置)",
    },
    fixedParams: {},
    fields: [
      {
        key: "handle",
        label: "Twitter 用户名 (handle)",
        type: "string",
        required: true,
        defaultValue: "elonmusk",
        placeholder: "例如 elonmusk",
        description: "Twitter 用户名",
      },
      {
        key: "user_id",
        label: "Twitter 数字 ID (user_id)",
        type: "string",
        required: true,
        defaultValue: "44196397",
        placeholder: "例如 44196397",
        description: "Twitter 用户纯数字 ID",
      },
    ],
    sampleParams: {
      handle: "elonmusk",
      user_id: "44196397",
    },
  },
];

/**
 * GET /api/admin/api-debugger/endpoints
 * 获取可调试接口列表与元数据
 */
router.get("/endpoints", (req, res) => {
  res.json({
    success: true,
    data: {
      endpoints: ENDPOINTS,
      configInfo: {
        baseUrl: PRO_API_CONFIG.baseUrl,
        apiKeyMasked: maskSecret(PRO_API_CONFIG.apiKey),
        crawlerQuotaUrl: CRAWLER_QUOTA_CONFIG.url,
      },
    },
  });
});

/**
 * 执行通用单个接口调试请求
 */
async function executeSingleEndpoint(endpoint, params = {}, options = {}) {
  const baseUrl = (options.baseUrlOverride || endpoint.defaultBaseUrl || PRO_API_CONFIG.baseUrl).replace(/\/+$/, "");
  const targetUrl = `${baseUrl}${endpoint.path}`;
  const apiKey = endpoint.id === "ghost_crawler_quota" ? CRAWLER_QUOTA_CONFIG.apiKey : PRO_API_CONFIG.apiKey;

  let requestHeaders = {
    "X-API-KEY": apiKey,
    ...(endpoint.method === "POST" ? { "X-Crawler-Pool": "general", "Content-Type": "application/json" } : {}),
    ...(options.customHeaders || {}),
  };

  let requestData = null;
  let requestParams = null;

  if (endpoint.method === "GET") {
    requestParams = {
      ...endpoint.fixedParams,
      ...params,
    };
  } else {
    requestData = {
      ...endpoint.fixedParams,
      ...params,
    };
    if (requestData.handle) {
      requestData.handle = cleanHandle(requestData.handle);
    }
    if (requestData.user_id) {
      requestData.user_id = cleanUserId(requestData.user_id);
    }
  }

  // 如果提供了高级完整 payload 覆盖
  if (options.customPayload && typeof options.customPayload === "object") {
    if (endpoint.method === "GET") {
      requestParams = options.customPayload;
    } else {
      requestData = options.customPayload;
    }
  }

  const maskedHeaders = {
    ...requestHeaders,
    "X-API-KEY": maskSecret(requestHeaders["X-API-KEY"]),
  };

  const startTime = Date.now();
  try {
    const timeout = endpoint.id === "ghost_social_following" ? 30000 : 15000;
    const axiosResponse = await axios({
      method: endpoint.method,
      url: targetUrl,
      headers: requestHeaders,
      params: requestParams,
      data: requestData,
      timeout,
    });
    const durationMs = Date.now() - startTime;

    return {
      status: axiosResponse.status,
      statusText: axiosResponse.statusText || "OK",
      durationMs,
      targetUrl,
      method: endpoint.method,
      requestHeaders: maskedHeaders,
      requestBody: endpoint.method === "GET" ? requestParams : requestData,
      responseHeaders: axiosResponse.headers || {},
      responseData: axiosResponse.data,
      isError: false,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (err.response) {
      // 目标下游接口返回了 HTTP 错误码 (4xx, 5xx)
      return {
        status: err.response.status,
        statusText: err.response.statusText || "Error",
        durationMs,
        targetUrl,
        method: endpoint.method,
        requestHeaders: maskedHeaders,
        requestBody: endpoint.method === "GET" ? requestParams : requestData,
        responseHeaders: err.response.headers || {},
        responseData: err.response.data,
        isError: true,
        error: {
          message: err.message,
          code: err.code || `HTTP_${err.response.status}`,
          type: "DOWNSTREAM_HTTP_ERROR",
        },
      };
    }

    // 网络不可达或连接超时 (如 ECONNREFUSED, ETIMEDOUT)
    return {
      status: err.code === "ECONNABORTED" ? 504 : 502,
      statusText: err.code || "Network Error",
      durationMs,
      targetUrl,
      method: endpoint.method,
      requestHeaders: maskedHeaders,
      requestBody: endpoint.method === "GET" ? requestParams : requestData,
      responseHeaders: {},
      responseData: null,
      isError: true,
      error: {
        message: `管理后台无法连通目标服务：${err.message}`,
        code: err.code || "NETWORK_ERROR",
        type: "NETWORK_OR_TIMEOUT",
        suggestion: "请确认后端 PRO_API_BASE_URL 配置或内网网络连接正常。",
      },
    };
  }
}

/**
 * 完整分析链路模拟 (端到端串联诊断)
 */
async function executeAnalyzePipeline(params, options = {}) {
  const handle = cleanHandle(params.handle);
  const userId = cleanUserId(params.user_id);
  const startTime = Date.now();

  const pipelineLog = [];

  // Step 1: 调用 First API (kol_tweets)
  pipelineLog.push({ step: "1_kol_tweets", action: "调用 /tweet/kol_tweets", input: { handle } });
  const step1Result = await executeSingleEndpoint(
    ENDPOINTS.find((item) => item.id === "ghost_kol_tweets"),
    { handle, offset: 0, verbose: false },
    options
  );

  let hasTweetInStep1 = false;
  if (!step1Result.isError && Array.isArray(step1Result.responseData) && step1Result.responseData.length > 0) {
    hasTweetInStep1 = true;
  }

  pipelineLog.push({
    step: "1_kol_tweets_result",
    status: step1Result.status,
    durationMs: step1Result.durationMs,
    hasTweets: hasTweetInStep1,
    summary: hasTweetInStep1 ? `First API 成功获取到 ${step1Result.responseData.length} 条推文` : "First API 未找到推文或返回空，触发降级",
  });

  if (hasTweetInStep1) {
    const durationMs = Date.now() - startTime;
    return {
      status: 200,
      statusText: "OK",
      durationMs,
      targetUrl: "Pipeline Simulation (First API Hit)",
      method: "POST",
      requestHeaders: { "X-API-KEY": maskSecret(PRO_API_CONFIG.apiKey) },
      requestBody: { handle, user_id: userId },
      responseHeaders: {},
      responseData: {
        finalStage: "first_api",
        decision: "First API (kol_tweets) 直接命中，无需降级",
        step1Result: step1Result.responseData,
        pipelineLog,
      },
      isError: false,
      error: null,
    };
  }

  // Step 2: 降级调用 Second API (user_tweets)
  pipelineLog.push({ step: "2_user_tweets", action: "降级调用 /tweet/user_tweets", input: { user_id: userId } });
  const step2Result = await executeSingleEndpoint(
    ENDPOINTS.find((item) => item.id === "ghost_user_tweets"),
    { user_id: userId },
    options
  );

  let hasTweetInStep2 = false;
  if (!step2Result.isError && Array.isArray(step2Result.responseData) && step2Result.responseData.length > 0) {
    hasTweetInStep2 = true;
  }

  pipelineLog.push({
    step: "2_user_tweets_result",
    status: step2Result.status,
    durationMs: step2Result.durationMs,
    hasTweets: hasTweetInStep2,
    summary: hasTweetInStep2 ? `Second API 成功获取到 ${step2Result.responseData.length} 条推文` : "Second API 仍无推文，准备调用 Third API 检查锁推",
  });

  if (hasTweetInStep2) {
    const durationMs = Date.now() - startTime;
    return {
      status: 200,
      statusText: "OK",
      durationMs,
      targetUrl: "Pipeline Simulation (Second API Hit)",
      method: "POST",
      requestHeaders: { "X-API-KEY": maskSecret(PRO_API_CONFIG.apiKey) },
      requestBody: { handle, user_id: userId },
      responseHeaders: {},
      responseData: {
        finalStage: "second_api",
        decision: "First API 为空，Second API (user_tweets) 命中推文",
        step1Result: step1Result.responseData,
        step2Result: step2Result.responseData,
        pipelineLog,
      },
      isError: false,
      error: null,
    };
  }

  // Step 3: 调用 Third API (profile_by_userid) 检查锁推
  pipelineLog.push({ step: "3_profile_by_userid", action: "检查是否锁推 /user/profile_by_userid", input: { user_id: userId } });
  const step3Result = await executeSingleEndpoint(
    ENDPOINTS.find((item) => item.id === "ghost_profile_by_userid"),
    { user_id: userId },
    options
  );

  const isProtected = step3Result.responseData?.protected === true;
  pipelineLog.push({
    step: "3_profile_result",
    status: step3Result.status,
    durationMs: step3Result.durationMs,
    isProtected,
    summary: isProtected ? "检测到用户账号为私密锁推状态 (protected = true)" : "用户未锁推但无推文，确认没有近期推文",
  });

  const totalDurationMs = Date.now() - startTime;
  return {
    status: 200,
    statusText: "OK",
    durationMs: totalDurationMs,
    targetUrl: "Pipeline Simulation (Full Evaluated)",
    method: "POST",
    requestHeaders: { "X-API-KEY": maskSecret(PRO_API_CONFIG.apiKey) },
    requestBody: { handle, user_id: userId },
    responseHeaders: {},
    responseData: {
      finalStage: "profile_checked",
      decision: isProtected ? "用户已开启推文保护 (锁推)" : "前两级均无推文，且用户公开档案确认无推文",
      profileData: step3Result.responseData,
      pipelineLog,
    },
    isError: step3Result.isError,
    error: step3Result.error,
  };
}

/**
 * POST /api/admin/api-debugger/execute
 * 执行接口调试
 */
router.post("/execute", async (req, res) => {
  const { endpointId, params = {}, customPayload, baseUrlOverride, customHeaders } = req.body || {};

  if (!endpointId) {
    return res.status(400).json({ success: false, error: "缺少 endpointId 参数" });
  }

  const endpoint = ENDPOINTS.find((item) => item.id === endpointId);
  if (!endpoint) {
    return res.status(404).json({ success: false, error: `未找到 ID 为 ${endpointId} 的调试接口配置` });
  }

  try {
    let execution;
    if (endpoint.id === "ghost_full_pipeline") {
      execution = await executeAnalyzePipeline(params, { baseUrlOverride, customHeaders });
    } else {
      execution = await executeSingleEndpoint(endpoint, params, { customPayload, baseUrlOverride, customHeaders });
    }

    return res.json({
      success: true,
      endpointId,
      execution,
    });
  } catch (error) {
    console.error(`[api-debugger] 执行 ${endpointId} 失败:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || "调试请求执行失败",
    });
  }
});

module.exports = router;
