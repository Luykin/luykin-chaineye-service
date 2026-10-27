const axios = require("axios");
const { DATA_SERVICE_BASE_URL } = require("../constants/dataService");
const {
  SPECIAL_AUTHORED_RANK,
  normalizeCreatorVerificationFromRankRecords,
} = require("./creatorVerificationService");

const CAMPAIGN_DISPLAY_DOMAINS = new Set(["web3", "ai"]);
const RANK_API_BY_DOMAIN = {
  web3: `${DATA_SERVICE_BASE_URL}/fetch/twitter/rank`,
  ai: `${DATA_SERVICE_BASE_URL}/fetch/ai/rank`,
};

function normalizeDisplayDomain(value) {
  if (Array.isArray(value)) return normalizeDisplayDomain(value[0]);
  if (value === null || value === undefined || value === "") return "";
  const normalized = String(value).trim().toLowerCase();
  return CAMPAIGN_DISPLAY_DOMAINS.has(normalized) ? normalized : null;
}

function normalizeRankDomains(domains) {
  const list = Array.isArray(domains) ? domains : [domains];
  const normalized = list.map(normalizeDisplayDomain).filter(Boolean);
  return Array.from(new Set(normalized.length ? normalized : ["web3"]));
}

function normalizeCreatorAuthPayload(rankData) {
  const authCreator = rankData?.auth_creator || null;
  const statusNumber = Number(authCreator?.status);
  const kolRank = Number(rankData?.kolRank);
  const hasStatus = Number.isFinite(statusNumber);
  const isCreatorAuthed = statusNumber === 2 || kolRank === SPECIAL_AUTHORED_RANK;

  return {
    status: hasStatus ? statusNumber : null,
    recordTime: authCreator?.record_time || authCreator?.recordTime || null,
    twitterId: authCreator?.twitter_id || authCreator?.twitterId || null,
    isCreatorAuthed,
  };
}

function isRankValid(rank) {
  return Number.isFinite(rank) && rank > 0;
}

async function fetchCampaignRankByDomain(domain, twitterId) {
  const apiBase = RANK_API_BY_DOMAIN[domain];
  if (!apiBase) throw new Error(`Unsupported rank domain: ${domain}`);

  const rankApiUrl = `${apiBase}?user_ids=${encodeURIComponent(twitterId)}`;
  const rankResponse = await axios.get(rankApiUrl, { timeout: 7000 });
  const list = rankResponse?.data?.data?.data;

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`Empty ${domain} ranking data`);
  }

  const userRankData = list[0];
  const creatorAuth = normalizeCreatorAuthPayload(userRankData);
  return {
    domain,
    kolRank: Number(userRankData.kolRank),
    isCreator: creatorAuth.isCreatorAuthed,
    isCreatorAuthed: creatorAuth.isCreatorAuthed,
    creatorAuth,
  };
}

function rankResultMeetsThreshold(result, threshold, includeCreator) {
  if (isRankValid(result?.kolRank) && result.kolRank <= threshold) return true;
  return !!includeCreator && !!result?.isCreator;
}

function serializeRankResult(result) {
  return {
    domain: result.domain,
    kolRank: isRankValid(result.kolRank) ? result.kolRank : null,
    isCreatorAuthed: !!result.isCreatorAuthed,
  };
}

function buildCreatorVerificationFromRankResults(results, twitterId) {
  const records = results.map((result) => ({
    domain: result.domain,
    record: {
      kolRank: result.kolRank,
      auth_creator: result.creatorAuth
        ? {
            status: result.creatorAuth.status,
            record_time: result.creatorAuth.recordTime,
            twitter_id: result.creatorAuth.twitterId,
          }
        : null,
    },
  }));
  return normalizeCreatorVerificationFromRankRecords(records, { twitterId });
}

async function evaluateRankEligibility({
  twitterId,
  threshold,
  includeCreator = false,
  domains = ["web3"],
  fetchRank = fetchCampaignRankByDomain,
} = {}) {
  const normalizedDomains = normalizeRankDomains(domains);
  const normalizedThreshold = threshold;
  const hasThreshold = Number.isInteger(normalizedThreshold) && normalizedThreshold > 0;
  const normalizedTwitterId = String(twitterId || "").trim();

  if (!hasThreshold) {
    return {
      status: "NOT_REQUIRED",
      reason: "NO_RANK_REQUIREMENT",
      threshold: null,
      includeCreator: !!includeCreator,
      domains: normalizedDomains,
      matchedDomain: null,
      matchedBy: null,
      ranks: [],
      creatorVerification: null,
      errors: [],
    };
  }

  if (!normalizedTwitterId || normalizedTwitterId === "null" || normalizedTwitterId === "undefined") {
    return {
      status: "AUTH_REQUIRED",
      reason: "AUTH_REQUIRED",
      threshold: normalizedThreshold,
      includeCreator: !!includeCreator,
      domains: normalizedDomains,
      matchedDomain: null,
      matchedBy: null,
      ranks: [],
      creatorVerification: null,
      errors: [],
    };
  }

  const settled = await Promise.allSettled(
    normalizedDomains.map((domain) => fetchRank(domain, normalizedTwitterId))
  );
  const fulfilled = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") fulfilled.push(result.value);
    else errors.push({ domain: normalizedDomains[index], message: result.reason?.message || String(result.reason) });
  });

  const rankMatch = fulfilled.find(
    (result) => isRankValid(result.kolRank) && result.kolRank <= normalizedThreshold
  );
  const creatorMatch = includeCreator
    ? fulfilled.find((result) => result.isCreator || result.isCreatorAuthed)
    : null;
  const creatorVerification = includeCreator
    ? buildCreatorVerificationFromRankResults(fulfilled, normalizedTwitterId)
    : null;
  const base = {
    threshold: normalizedThreshold,
    includeCreator: !!includeCreator,
    domains: normalizedDomains,
    ranks: fulfilled.map(serializeRankResult),
    creatorVerification,
    errors,
  };

  if (rankMatch) {
    return {
      ...base,
      status: "ELIGIBLE",
      reason: "ELIGIBLE_BY_RANK",
      matchedDomain: rankMatch.domain,
      matchedBy: "RANK",
    };
  }
  if (creatorMatch) {
    return {
      ...base,
      status: "ELIGIBLE",
      reason: "ELIGIBLE_BY_CREATOR",
      matchedDomain: creatorMatch.domain,
      matchedBy: "CREATOR",
    };
  }
  if (!fulfilled.length || errors.length > 0) {
    return {
      ...base,
      status: "UNKNOWN",
      reason: "RANK_DATA_UNAVAILABLE",
      matchedDomain: null,
      matchedBy: null,
    };
  }
  if (!includeCreator) {
    return {
      ...base,
      status: "INELIGIBLE",
      reason: "RANK_REQUIREMENT_NOT_MET",
      matchedDomain: null,
      matchedBy: null,
    };
  }

  let reason = "CREATOR_VERIFICATION_COOLDOWN";
  if (creatorVerification.status === "PENDING") reason = "CREATOR_VERIFICATION_PENDING";
  else if (creatorVerification.canApply) reason = "CREATOR_VERIFICATION_AVAILABLE";

  return {
    ...base,
    status: "INELIGIBLE",
    reason,
    matchedDomain: null,
    matchedBy: null,
  };
}

module.exports = {
  RANK_API_BY_DOMAIN,
  evaluateRankEligibility,
  fetchCampaignRankByDomain,
  isRankValid,
  normalizeCreatorAuthPayload,
  normalizeDisplayDomain,
  normalizeRankDomains,
  rankResultMeetsThreshold,
};
