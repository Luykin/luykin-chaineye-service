/**
 * pgvector 通用工具函数。
 *
 * 这里不拼业务 SQL，只做输入清洗和 vector literal 序列化：
 * - limit 做上下限保护；
 * - 字符串/数组过滤条件做长度和数量限制；
 * - embedding 数组转成 pgvector 可识别的 "[0.1,0.2]" 字面量。
 */

function clampLimit(limit, { defaultLimit = 20, maxLimit = 50 } = {}) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(Math.max(Math.floor(parsed), 1), maxLimit);
}

function normalizeString(value, maxLength = 64) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : "";
}

function normalizeStringArray(value, maxItems = 10, maxItemLength = 64) {
  // 数组条件统一去重、去空、限长，防止用户传超大 filters 拖慢 SQL。
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => normalizeString(item, maxItemLength))
        .filter(Boolean)
    )
  ).slice(0, maxItems);
}

function normalizeNonNegativeInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function vectorToPgLiteral(values, expectedDimensions = 1536) {
  // pgvector 支持 "[1,2,3]" 形式的字符串 literal；最终仍通过 bind 参数传入 SQL。
  if (!Array.isArray(values) || values.length !== expectedDimensions) {
    const error = new Error(`embedding dimension must be ${expectedDimensions}`);
    error.code = "VECTOR_EMBEDDING_DIMENSION_MISMATCH";
    throw error;
  }

  const serialized = values.map((value) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      const error = new Error("embedding contains non-finite value");
      error.code = "VECTOR_EMBEDDING_INVALID";
      throw error;
    }
    return numberValue.toFixed(8);
  });

  return `[${serialized.join(",")}]`;
}

module.exports = {
  clampLimit,
  normalizeNonNegativeInteger,
  normalizeString,
  normalizeStringArray,
  vectorToPgLiteral,
};
