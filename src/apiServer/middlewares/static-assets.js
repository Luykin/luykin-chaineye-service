const express = require("express");
const path = require("path");

const ONE_DAY_SECONDS = 24 * 60 * 60;
const ONE_YEAR_SECONDS = 365 * ONE_DAY_SECONDS;

function setFrontendStaticCacheHeaders(res, filePath, stat) {
  // 关键防御：如果文件为空（例如在构建写入中被并发请求击中），绝对不可设置长期强缓存
  if (stat && stat.size === 0) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return;
  }

  const normalizedPath = filePath.split(path.sep).join("/");
  const isHtml = /\.html?$/i.test(normalizedPath);
  const isViteHashedAsset = /\/admin-web\/assets\//.test(normalizedPath);
  const isCompressibleAsset = /\.(?:js|css|mjs|json|svg)$/i.test(normalizedPath);
  const isImageOrFont = /\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|otf)$/i.test(normalizedPath);

  res.setHeader("Vary", "Accept-Encoding");

  if (isHtml) {
    // HTML 是入口文件，需要每次向服务器确认；资源文件用长缓存。
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    return;
  }

  if (isViteHashedAsset) {
    // Vite assets 文件名带 hash，可安全走长期强缓存。
    res.setHeader("Cache-Control", `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    return;
  }

  if (isCompressibleAsset || isImageOrFont) {
    // 未 hash 的历史静态资源保留协商缓存，给较短 freshness，避免后续替换文件不生效。
    res.setHeader("Cache-Control", `public, max-age=${ONE_DAY_SECONDS}, stale-while-revalidate=${7 * ONE_DAY_SECONDS}`);
  }
}

const frontendStaticOptions = {
  etag: true,
  lastModified: true,
  setHeaders: setFrontendStaticCacheHeaders,
};

/**
 * 静态文件服务：新版 admin-web 自带的资源优先，旧 public/static 仅作为历史页面兜底。
 * 缓存策略：HTML no-cache；Vite hashed assets 一年 immutable；未 hash 历史资源短缓存 + ETag/Last-Modified 协商。
 */
function setupStaticAssets(app) {
  const projectRoot = path.resolve(__dirname, "../../../");
  app.use("/static", express.static(path.join(projectRoot, "admin-web/public/static"), frontendStaticOptions));
  app.use("/static", express.static(path.join(projectRoot, "public/static"), frontendStaticOptions));
}

module.exports = {
  setFrontendStaticCacheHeaders,
  frontendStaticOptions,
  setupStaticAssets,
};
