const express = require("express");
const router = express.Router();
const http = require("http");
const https = require("https");
const { URL } = require("url");
const crypto = require("crypto");

// 缓存配置（根据实际需求调整）
const CACHE_TTL = 60 * 60; // 缓存时间（秒）
const CACHE_MAX_SIZE = 1024 * 1024; // 单条缓存最大体积（1MB）

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
        // 设置 CORS 响应头
        res.setHeader("Access-Control-Allow-Origin", "*"); // 动态设置 Origin
        res.setHeader("Access-Control-Allow-Credentials", "false"); // 允许凭据
        res.setHeader("Access-Control-Allow-Methods", "GET"); // 支持 GET 方法

        return res.send(body);
      } catch (parseError) {
        console.error("Cache data parse error:", parseError);
      }
    }

    // 缓存未命中，执行代理请求
    const parsedUrl = new URL(targetUrl);
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
    // 设置 CORS 响应头
    res.setHeader("Access-Control-Allow-Origin", "*"); // 动态设置 Origin
    res.setHeader("Access-Control-Allow-Credentials", "false"); // 允许凭据
    res.setHeader("Access-Control-Allow-Methods", "GET"); // 支持 GET 方法

    res.send(responseBody);
  } catch (err) {
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
    const parsedUrl = new URL(targetUrl);
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
    // 设置 CORS 响应头
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Credentials", "false");
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    res.send(responseBody);
  } catch (err) {
    console.error("POST Proxy error:", err);
    res.status(502).json({ error: "Bad Gateway" });
  }
});

module.exports = router;
