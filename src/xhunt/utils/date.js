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

module.exports = { parseUtcDateParam };
