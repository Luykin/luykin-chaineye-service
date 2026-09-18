function decimalToCents(value, field = "金额", { allowZero = false } = {}) {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  if (!raw || !/^\d{1,18}(?:\.\d{1,2})?$/.test(raw)) {
    const error = new Error(`${field} 必须是${allowZero ? "非负" : "大于 0"}且最多两位小数的金额`);
    error.status = 400;
    error.code = "INVALID_MONEY";
    throw error;
  }
  const [integer, fraction = ""] = raw.split(".");
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents < 0n || (!allowZero && cents === 0n)) {
    const error = new Error(`${field} 必须是${allowZero ? "非负" : "大于 0"}且最多两位小数的金额`);
    error.status = 400;
    error.code = "INVALID_MONEY";
    throw error;
  }
  return cents;
}

function formatCents(value) {
  const cents = BigInt(value);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function sumMoney(values) {
  return values.reduce((total, value) => total + decimalToCents(value || "0.00", "金额", { allowZero: true }), 0n);
}

module.exports = {
  decimalToCents,
  formatCents,
  sumMoney,
};
