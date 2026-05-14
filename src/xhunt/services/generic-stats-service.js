const { GenericStatEvent } = require("../../models/postgres-start");

function normalizeString(value, maxLength = 255) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.slice(0, maxLength);
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

async function recordGenericStat(payload = {}) {
  const {
    type,
    source,
    action,
    subjectType,
    subjectId,
    subjectName,
    actorType,
    actorId,
    actorName,
    eventAt,
    countValue = 1,
    numericValue = null,
    dimensions = null,
    metrics = null,
    meta = null,
  } = payload;

  if (!type || !source || !action) {
    throw new Error("type/source/action 不能为空");
  }

  return GenericStatEvent.create({
    type: normalizeString(type, 100),
    source: normalizeString(source, 50),
    action: normalizeString(action, 50),
    subjectType: normalizeString(subjectType, 50),
    subjectId: normalizeString(subjectId, 255),
    subjectName: normalizeString(subjectName, 255),
    actorType: normalizeString(actorType, 50),
    actorId: normalizeString(actorId, 255),
    actorName: normalizeString(actorName, 255),
    eventAt: eventAt ? new Date(eventAt) : new Date(),
    countValue: Number.isFinite(Number(countValue))
      ? Math.max(0, parseInt(countValue, 10))
      : 1,
    numericValue:
      numericValue === null || numericValue === undefined
        ? null
        : Number(numericValue),
    dimensions: normalizeObject(dimensions),
    metrics: normalizeObject(metrics),
    meta: normalizeObject(meta),
  });
}

module.exports = {
  recordGenericStat,
};
