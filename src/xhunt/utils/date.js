// 解析 UTC 时间参数：支持秒/毫秒时间戳或 ISO 字符串
function parseUtcDateParam(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    let num = parseInt(s, 10);
    if (s.length <= 10) num *= 1000; // 10位视为秒
    const d = new Date(num);
    return Number.isNaN(d.getTime()) ? null : d; // Date 基于 UTC
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * 获取中国时区的今日开始时间（UTC）
 * 北京时间今日 00:00:00 对应的 UTC 时间
 */
function getTodayStartChina() {
  const now = new Date();
  const beijingDate = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
  const year = beijingDate.getFullYear();
  const month = beijingDate.getMonth();
  const day = beijingDate.getDate();

  // 创建北京时间今日 00:00:00
  const beijingTodayStart = new Date(year, month, day, 0, 0, 0, 0);

  // 计算UTC时间：北京时间减去8小时
  const utcTime = new Date(beijingTodayStart.getTime() - 8 * 60 * 60 * 1000);
  return utcTime;
}

/**
 * 获取中国时区的今日结束时间（UTC）
 * 北京时间今日 23:59:59.999 对应的 UTC 时间
 */
function getTodayEndChina() {
  const now = new Date();
  const beijingDate = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
  const year = beijingDate.getFullYear();
  const month = beijingDate.getMonth();
  const day = beijingDate.getDate();

  // 创建北京时间今日 23:59:59.999
  const beijingTodayEnd = new Date(year, month, day, 23, 59, 59, 999);

  // 计算UTC时间：北京时间减去8小时
  const utcTime = new Date(beijingTodayEnd.getTime() - 8 * 60 * 60 * 1000);
  return utcTime;
}

/**
 * 格式化日期时间（中国时区）
 */
function formatDateTimeChina(date = new Date()) {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * 获取中国时区的当前日期字符串（YYYY-MM-DD）
 */
function getChinaDateString(date = new Date()) {
  const chinaDate = new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
  return chinaDate.toISOString().split("T")[0];
}

/**
 * 将UTC时间转换为中国时区时间
 */
function utcToChinaTime(utcDate) {
  return new Date(utcDate.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

module.exports = { 
  parseUtcDateParam,
  getTodayStartChina,
  getTodayEndChina,
  formatDateTimeChina,
  getChinaDateString,
  utcToChinaTime
};
