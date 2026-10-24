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

  // 3. 征文名单 Excel 预览使用 base64 传输，解析后不会直接写入配置。
  app.use(
    "/api/xhunt/stats/essay-contest-winners/import-preview",
    express.json({
      limit: "5mb",
      verify: captureRawBody,
    })
  );

  // 4. 普通接口：200KB 限制
  app.use(express.json({ limit: "200kb", verify: captureRawBody }));
}

module.exports = {
  captureRawBody,
  setupBodyParsers,
};
