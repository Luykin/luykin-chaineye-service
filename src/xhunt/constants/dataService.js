/**
 * 外部/内网数据服务 Base URL 配置
 * 生产环境优先走内网域名（80 端口 HTTP，低延迟免证书）；非生产环境默认走公网域名
 */
const DATA_SERVICE_BASE_URL =
  process.env.DATA_SERVICE_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://data.internal.biteye.info"
    : "https://data.cryptohunt.ai");

// 数据服务对外公网域名。服务端请求时需改写为内网 DATA_SERVICE_BASE_URL，
// 避免生产环境从内部网络回源公网域名失败（502）。
const PUBLIC_DATA_SERVICE_BASE_URL =
  process.env.PUBLIC_DATA_SERVICE_BASE_URL || "https://data.cryptohunt.ai";

module.exports = {
  DATA_SERVICE_BASE_URL,
  PUBLIC_DATA_SERVICE_BASE_URL,
};
