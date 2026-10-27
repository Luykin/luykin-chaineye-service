const E2E_CAMPAIGN_TARGET_OPTIONS = Object.freeze([50000, 100000, 200000, -1]);
const E2E_CAMPAIGN_TARGET_OPTION_SET = new Set(E2E_CAMPAIGN_TARGET_OPTIONS);

const E2E_CAMPAIGN_EDITABLE_FIELDS = Object.freeze({
  pending: Object.freeze([
    "target",
    "winners",
    "type",
    "lang",
    "retro",
    "end_time",
  ]),
  active: Object.freeze(["end_time"]),
  review: Object.freeze([]),
  complete: Object.freeze([]),
});

function parseStrictInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeE2eCampaignTarget(value, fallback = 200000) {
  const parsed = parseStrictInteger(value);
  return E2E_CAMPAIGN_TARGET_OPTION_SET.has(parsed) ? parsed : fallback;
}

function getE2eCampaignEditableFields(status) {
  return E2E_CAMPAIGN_EDITABLE_FIELDS[String(status || "").toLowerCase()] || [];
}

function getDisallowedE2eCampaignUpdateFields(status, fields) {
  const allowed = new Set(getE2eCampaignEditableFields(status));
  return fields.filter((field) => !allowed.has(field));
}

module.exports = {
  E2E_CAMPAIGN_TARGET_OPTIONS,
  getDisallowedE2eCampaignUpdateFields,
  getE2eCampaignEditableFields,
  normalizeE2eCampaignTarget,
};
