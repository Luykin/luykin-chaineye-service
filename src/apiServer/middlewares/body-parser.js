const express = require("express");

function captureRawBody(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  } else {
    req.rawBody = "";
  }
}

/**
 * 针对不同路由设置差异化的请求体大小限制
 * 特殊大 body 路由必须放在默认 200KB 之前
 */
function setupBodyParsers(app) {
  // 1. 上报接口允许更大的请求体 (1000kb)
  app.use(
    "/api/xhunt/report",
    express.json({
      limit: "1000kb",
      verify: captureRawBody,
    })
  );

  // 2. Nacos配置管理接口允许更大的请求体 (2000kb)
  app.use(
    "/api/xhunt/stats/nacos/config",
    express.json({
      limit: "2000kb",
      verify: captureRawBody,
    })
  );

  // 3. 普通接口：200KB 限制
  app.use(express.json({ limit: "200kb", verify: captureRawBody }));
}

module.exports = {
  captureRawBody,
  setupBodyParsers,
};
