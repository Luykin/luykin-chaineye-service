const express = require("express");
const router = express.Router();
const http = require("http");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");
const { URL } = require("url");
const crypto = require("crypto");

// 缓存配置（根据实际需求调整）
const CACHE_TTL = 60 * 60; // 缓存时间（秒）
const CACHE_MAX_SIZE = 1024 * 1024; // 单条缓存最大体积（1MB）

function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== "string") return true;
  const normalized = ip.trim().toLowerCase();

  // 处理 IPv4-mapped IPv6 (如 ::ffff:127.0.0.1)
  if (normalized.startsWith("::ffff:")) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateOrReservedIp(v4Part);
    }
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((n) => parseInt(n, 10));
    const [a, b] = parts;
    if (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8
      a === 127 || // 127.0.0.0/8 (Loopback)
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
      (a === 169 && b === 254) || // 169.254.0.0/16 (Link-local / Cloud Metadata)
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      a >= 224 // Multicast & Reserved
    ) {
      return true;
    }
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fe80:") || // Link-local
      normalized.startsWith("fc") || // Unique local (fc00::/7)
      normalized.startsWith("fd") ||
      normalized.startsWith("ff") // Multicast
    ) {
      return true;
    }
    return false;
  }

  return true;
}

async function validateSafeProxyTarget(targetUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (_) {
    const err = new Error("Invalid URL");
    err.statusCode = 400;
    throw err;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    const err = new Error("Unsupported protocol");
    err.statusCode = 400;
    throw err;
  }

  const hostname = (parsedUrl.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    const err = new Error("Forbidden target host");
    err.statusCode = 403;
    throw err;
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      const err = new Error("Forbidden private IP address");
      err.statusCode = 403;
      throw err;
    }
    return parsedUrl;
  }

  const records = await dns.lookup(hostname, { all: true });
  if (!Array.isArray(records) || records.length === 0) {
    const err = new Error("Unable to resolve target host");
    err.statusCode = 502;
    throw err;
  }

  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      const err = new Error("Forbidden private network target");
      err.statusCode = 403;
      throw err;
    }
  }

  return parsedUrl;
}

// 仅在未设置时补充 CORS 头，避免覆盖上游自带配置
const ensureCorsHeaders = (req, res, allowMethods) => {
  const requestOrigin = req.headers.origin;

  res.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");

  if (!res.hasHeader("Access-Control-Allow-Credentials")) {
    res.setHeader("Access-Control-Allow-Credentials", "false");
  }

  if (!res.hasHeader("Access-Control-Allow-Methods")) {
    res.setHeader("Access-Control-Allow-Methods", allowMethods);
  }
};

// 生成MD5哈希作为缓存键
const getCacheKey = (url) =>
  crypto.createHash("md5").update(`${url}_202503162029`).digest("hex");

router.get("/", async (req, res) => {
  const { url: encodedUrl } = req.query;

  if (!encodedUrl) {
    return res.status(400).json({ error: "Missing URL parameter" });
  }

  try {
    const targetUrl = decodeURIComponent(encodedUrl);
    const parsedUrl = await validateSafeProxyTarget(targetUrl);
    const cacheKey = getCacheKey(targetUrl);
    let cachedData;

    // 尝试获取缓存
    try {
      cachedData = await req.redisClient.get(cacheKey);
    } catch (redisError) {
      console.error("Redis GET failed:", redisError);
    }

    // 缓存命中
    if (cachedData) {
      try {
        const { headers, statusCode, body } = JSON.parse(cachedData);

        // 设置响应头和状态码
        res.status(statusCode);
        Object.entries(headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        ensureCorsHeaders(req, res, "GET");

        return res.send(body);
      } catch (parseError) {
        console.error("Cache data parse error:", parseError);
      }
    }

    // 缓存未命中，执行代理请求
    const client = parsedUrl.protocol === "https:" ? https : http;

    const proxyRes = await new Promise((resolve, reject) => {
      const proxyReq = client.get(parsedUrl, (response) => {
        resolve(response);
      });
      proxyReq.on("error", reject);
    });

    // 收集响应数据
    let responseBody = [];
    proxyRes.on("data", (chunk) => responseBody.push(chunk));
    await new Promise((resolve) => proxyRes.on("end", resolve));
    responseBody = Buffer.concat(responseBody);

    // 缓存响应数据（仅缓存2xx状态码的响应）
    if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
      try {
        const cacheData = JSON.stringify({
          headers: proxyRes.headers,
          statusCode: proxyRes.statusCode,
          body: responseBody.toString("utf8"),
        });

        // 限制缓存体积
        if (Buffer.byteLength(cacheData) <= CACHE_MAX_SIZE) {
          await req.redisClient.set(cacheKey, cacheData, "EX", CACHE_TTL);
        }
      } catch (redisError) {
        console.error("Redis SET failed:", redisError);
      }
    }

    // 返回响应
    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    ensureCorsHeaders(req, res, "GET");

    res.send(responseBody);
  } catch (err) {
    if (err?.statusCode === 400 || err?.statusCode === 403) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Proxy error:", err);
    res.status(502).json({ error: "Bad Gateway" });
  }
});

// POST 代理路由，支持 JSON-RPC 请求
router.post("/", async (req, res) => {
  const { url: encodedUrl } = req.query;

  if (!encodedUrl) {
    return res.status(400).json({ error: "Missing URL parameter" });
  }

  try {
    const targetUrl = decodeURIComponent(encodedUrl);
    const parsedUrl = await validateSafeProxyTarget(targetUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    // 准备请求选项
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(JSON.stringify(req.body)),
      },
    };

    // 执行代理请求
    const proxyRes = await new Promise((resolve, reject) => {
      const proxyReq = client.request(options, (response) => {
        resolve(response);
      });

      proxyReq.on("error", reject);

      // 发送请求体
      proxyReq.write(JSON.stringify(req.body));
      proxyReq.end();
    });

    // 收集响应数据
    let responseBody = [];
    proxyRes.on("data", (chunk) => responseBody.push(chunk));
    await new Promise((resolve) => proxyRes.on("end", resolve));
    responseBody = Buffer.concat(responseBody);

    // 返回响应
    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    ensureCorsHeaders(req, res, "POST");
    if (!res.hasHeader("Access-Control-Allow-Headers")) {
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    res.send(responseBody);
  } catch (err) {
    if (err?.statusCode === 400 || err?.statusCode === 403) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("POST Proxy error:", err);
    res.status(502).json({ error: "Bad Gateway" });
  }
});

module.exports = router;
