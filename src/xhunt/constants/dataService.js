/**
 * 外部/内网数据服务 Base URL 配置
 * 生产环境优先走内网域名（80 端口 HTTP，低延迟免证书）；非生产环境默认走公网域名
 */
const DATA_SERVICE_BASE_URL =
  process.env.DATA_SERVICE_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://data.internal.biteye.info"
    : "https://data.cryptohunt.ai");

module.exports = {
  DATA_SERVICE_BASE_URL,
};
