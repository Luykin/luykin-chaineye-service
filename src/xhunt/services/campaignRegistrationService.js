const axios = require("axios");
const { Op } = require("sequelize");
const { CampaignRegistration } = require("../../models/postgres-start");
const { getManagedCampaignPayloadByKey } = require("./websiteCampaignService");
const { isRequestXHuntVip } = require("../constants/xhuntVip");
const { DATA_SERVICE_BASE_URL } = require("../constants/dataService");
const {
  RANK_API_BY_DOMAIN,
  evaluateRankEligibility,
  fetchCampaignRankByDomain,
  normalizeCreatorAuthPayload,
  normalizeDisplayDomain,
  rankResultMeetsThreshold,
} = require("./rankEligibilityService");

const INITIALIZE_CAMPAIGN_URL = `${DATA_SERVICE_BASE_URL}/pro/api/initialize_campaign`;
const INITIALIZE_CAMPAIGN_CACHE_TTL = 86400;
const CAMPAIGN_NOT_ENABLED_MESSAGES = {
  "zh-CN": "活动尚未开始，敬请关注。",
  en: "This campaign has not started yet. Please stay tuned.",
};

function campaignRegistrationError(code, status = 400, publicMessage, details) {
  const error = new Error(code);
  error.status = status;
  if (publicMessage && typeof publicMessage === "object") {
    error.publicMessages = publicMessage;
    error.publicMessage = publicMessage["zh-CN"] || publicMessage.en || code;
  } else if (publicMessage) {
    error.publicMessage = publicMessage;
  }
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeCampaignIdentifier(raw) {
  if (!raw || typeof raw !== "string") return null;
  return raw.trim();
}

function normalizeRegistrationEmail(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw).trim().toLowerCase();
}

function isValidRegistrationEmail(value) {
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeTesterHandle(value) {
  if (Array.isArray(value)) return normalizeTesterHandle(value[0]);
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function isCampaignTester(campaign, requestHandleOrViewer) {
  if (!campaign || !requestHandleOrViewer) return false;
  const list = Array.isArray(campaign.testList) ? campaign.testList : [];
  const requestIdentifiers = typeof requestHandleOrViewer === "object"
    ? [requestHandleOrViewer.username, requestHandleOrViewer.twitterId]
    : [requestHandleOrViewer];
  const normalized = requestIdentifiers.map(normalizeTesterHandle).filter(Boolean);
  if (!normalized.length) return false;
  return list.some((item) => normalized.includes(normalizeTesterHandle(item)));
}

function getCampaignDisplayDomains(campaign) {
  const list = Array.isArray(campaign?.displayDomains) ? campaign.displayDomains : ["web3"];
  const domains = list.map((item) => normalizeDisplayDomain(item)).filter(Boolean);
  return domains.length ? domains : ["web3"];
}

function matchesDisplayDomain(campaign, domain) {
  if (!domain) return true;
  return getCampaignDisplayDomains(campaign).includes(domain);
}

function formatRankForMessage(result) {
  if (!result) return "unknown";
  return Number.isFinite(result.kolRank) && result.kolRank > 0 ? result.kolRank : "unranked";
}

async function validateCampaignThreshold(campaign, twitterId) {
  if (!campaign || !Number.isInteger(campaign.threshold)) return null;
  const normalizedTwitterId = String(twitterId || "").trim();
  if (!normalizedTwitterId || normalizedTwitterId === "null" || normalizedTwitterId === "undefined") {
    throw campaignRegistrationError("INVALID_TWITTER_ID", 400, "Invalid Twitter ID");
  }

  const domainsToCheck = getCampaignDisplayDomains(campaign).filter((domain) => RANK_API_BY_DOMAIN[domain]);
  const eligibility = await evaluateRankEligibility({
    twitterId: normalizedTwitterId,
    threshold: campaign.threshold,
    includeCreator: campaign.includeCreator,
    domains: domainsToCheck,
  });

  if (eligibility.status === "ELIGIBLE" || eligibility.status === "NOT_REQUIRED") {
    return { ranks: eligibility.ranks, domains: eligibility.domains, eligibility };
  }

  if (eligibility.status === "UNKNOWN") {
    throw campaignRegistrationError(
      "RANK_DATA_UNAVAILABLE",
      502,
      "Failed to fetch user ranking data",
      eligibility
    );
  }

  const rankSummary = eligibility.ranks.map((result) => `${result.domain}: ${formatRankForMessage(result)}`).join(", ");
  throw campaignRegistrationError(
    "THRESHOLD_NOT_MET",
    400,
    `Does not meet registration threshold: KOL rank must be <= ${campaign.threshold}, current rank is ${rankSummary}`,
    eligibility
  );
}

async function validateTwitterProfileQuality(req, twitterId) {
  if (isRequestXHuntVip(req)) return null;
  try {
    const response = await axios.post(
      `${DATA_SERVICE_BASE_URL}/pro/api/inner/profile_by_userid`,
      { user_id: String(twitterId) },
      { timeout: 7000 }
    );
    const data = response?.data || null;
    if (!data || !data.created_at || typeof data.followers_count !== "number") {
      throw campaignRegistrationError("PROFILE_DATA_INCOMPLETE", 502, "External profile data is incomplete");
    }
    const createdAt = new Date(data.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      throw campaignRegistrationError("PROFILE_CREATED_AT_INVALID", 502, "External profile created_at is invalid");
    }
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    if (createdAt > oneMonthAgo) {
      throw campaignRegistrationError("ACCOUNT_TOO_NEW", 400, "X account must be older than 1 month");
    }
    if (data.followers_count < 50) {
      throw campaignRegistrationError("FOLLOWERS_TOO_LOW", 400, "X account must have at least 50 followers");
    }
    return data;
  } catch (error) {
    if (error?.status) throw error;
    throw campaignRegistrationError("PROFILE_CHECK_FAILED", 502, "External profile check request failed");
  }
}

function normalizeRegistrationContact({ evmAddress, email, emil } = {}) {
  const rawEmail = email !== undefined ? email : emil;
  const trimmedAddress = typeof evmAddress === "string" && evmAddress.trim() ? evmAddress.trim() : null;
  const normalizedEmail = normalizeRegistrationEmail(rawEmail);
  return {
    evmAddress: trimmedAddress,
    email: normalizedEmail || null,
    hasEmail: !!normalizedEmail,
  };
}

function validateRegistrationContact(campaign, contact) {
  const allowEmailRegistration = campaign?.allowEmailRegistration === true;
  const trimmedAddress = contact?.evmAddress || null;
  const normalizedEmail = contact?.email || "";
  const hasEmail = !!normalizedEmail;
  const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;

  if (trimmedAddress && !evmAddressRegex.test(trimmedAddress)) {
    throw campaignRegistrationError("INVALID_EVM_ADDRESS", 400, "Invalid EVM address format");
  }

  if (!allowEmailRegistration) {
    if (hasEmail) throw campaignRegistrationError("EMAIL_NOT_ALLOWED", 400, "Email registration is not allowed for this campaign");
    if (!trimmedAddress) throw campaignRegistrationError("EVM_ADDRESS_REQUIRED", 400, "EVM address is required");
  } else {
    if (!trimmedAddress && !hasEmail) throw campaignRegistrationError("CONTACT_REQUIRED", 400, "EVM address or email is required");
    if (trimmedAddress && hasEmail) throw campaignRegistrationError("CONTACT_CONFLICT", 400, "Please provide either EVM address or email, not both");
    if (hasEmail && !isValidRegistrationEmail(normalizedEmail)) throw campaignRegistrationError("INVALID_EMAIL", 400, "Invalid email format");
  }
}

async function validateRegistrationCooldown(redisClient, cooldownKey) {
  if (!redisClient || !cooldownKey) return null;
  const ttl = await redisClient.ttl(cooldownKey).catch(() => 0);
  if (typeof ttl === "number" && ttl > 0) {
    throw campaignRegistrationError("TOO_FREQUENT", 429, `Too frequent requests, please try again in ${ttl}s`, { ttl });
  }
  await redisClient.setEx(cooldownKey, 10, "1").catch(() => {});
  return null;
}

function validateCampaignWindow(campaign, { allowComingSoonWarmup = false } = {}) {
  const startAt = campaign?.enrollmentWindow?.startAt ? new Date(campaign.enrollmentWindow.startAt) : null;
  const endAt = campaign?.enrollmentWindow?.endAt ? new Date(campaign.enrollmentWindow.endAt) : null;
  if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw campaignRegistrationError("INVALID_ENROLLMENT_WINDOW", 502, "Invalid enrollment window in config");
  }

  const now = new Date();
  const startAtWithGrace = new Date(startAt.getTime() - 60 * 60 * 1000);
  if ((!allowComingSoonWarmup && now < startAtWithGrace) || now > endAt) {
    throw campaignRegistrationError("OUTSIDE_ENROLLMENT_WINDOW", 400, "Not within the enrollment window");
  }
}

function validateTestingCampaignAccess(campaign, req, { channel = "plugin", viewer = null } = {}) {
  if (!campaign?.testingPhase) return;
  const headers = req?.headers || {};
  const testerIdentity = {
    username: viewer?.username || headers["x-user-id"],
    twitterId: viewer?.twitterId || req?.user?.twitterId || headers["x-tw-id"],
  };
  // 测试活动报名权限与活动可见性保持一致：只要当前用户命中该活动 testList 即可。
  // 不再额外要求 internal_test，避免能看到活动的测试用户在报名阶段被拦截。
  const allowed = isCampaignTester(campaign, testerIdentity);
  if (!allowed) {
    throw campaignRegistrationError("CAMPAIGN_IN_TESTING", 403, "Campaign is in testing phase");
  }
}

async function loadCampaignConfigForRegistration(campaignKey, req, options = {}) {
  const normalizedCampaign = normalizeCampaignIdentifier(campaignKey);
  if (!normalizedCampaign) throw campaignRegistrationError("CAMPAIGN_REQUIRED", 400, "campaign is required");

  let found = null;
  try {
    found = await getManagedCampaignPayloadByKey(normalizedCampaign, {
      includeTesting: true,
      channel: options.channel || null,
    });
  } catch (error) {
    throw campaignRegistrationError("CAMPAIGN_CONFIG_UNAVAILABLE", 502, "Campaign configuration service unavailable");
  }

  if (!found) throw campaignRegistrationError("INVALID_CAMPAIGN", 400, "Invalid campaign identifier");
  if (!found.enabled) throw campaignRegistrationError("CAMPAIGN_NOT_ENABLED", 400, CAMPAIGN_NOT_ENABLED_MESSAGES);
  validateTestingCampaignAccess(found, req, { channel: options.channel, viewer: options.viewer });
  validateCampaignWindow(found, { allowComingSoonWarmup: !!options.allowComingSoonWarmup });
  return found;
}

async function assertUniqueRegistrationContact(campaign, contact) {
  if (contact?.evmAddress) {
    const existingEVM = await CampaignRegistration.findOne({ where: { campaign, evmAddress: contact.evmAddress } });
    if (existingEVM) throw campaignRegistrationError("EVM_ALREADY_USED", 409, "This EVM address is already in use");
  }
  if (contact?.email) {
    const existingEmail = await CampaignRegistration.findOne({ where: { campaign, email: contact.email } });
    if (existingEmail) throw campaignRegistrationError("EMAIL_ALREADY_USED", 409, "This email is already in use");
  }
}

async function findExistingCampaignRegistration(campaign, user) {
  const orConditions = [];
  if (user?.xHuntUserId) orConditions.push({ xHuntUserId: user.xHuntUserId });
  if (user?.twitterId) orConditions.push({ twitterId: user.twitterId });
  if (!orConditions.length) return null;
  return CampaignRegistration.findOne({
    where: {
      campaign,
      [Op.or]: orConditions,
    },
    order: [["registeredAt", "DESC"]],
  });
}

async function notifyInitializeCampaign(redisClient, campaign) {
  if (!redisClient || !campaign) return;
  const cacheKey = `campaign:initialize_campaign:${campaign}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return;
  } catch (_) {}
  try {
    const resp = await axios.post(INITIALIZE_CAMPAIGN_URL, { campaign }, { timeout: 10000 });
    if (resp?.data?.status === true) {
      try {
        await redisClient.setEx(cacheKey, INITIALIZE_CAMPAIGN_CACHE_TTL, "1");
      } catch (_) {}
    }
  } catch (error) {
    console.warn("[CampaignRegistration] initialize_campaign notify warn:", error.message || error);
  }
}

async function updateEvmAddressOnUser(userRecord, evmAddress) {
  if (!userRecord || !evmAddress || typeof userRecord.update !== "function") return;
  const normalized = String(evmAddress).trim();
  const list = Array.isArray(userRecord.evmAddresses) ? userRecord.evmAddresses : [];
  const exists = list.some((addr) => String(addr).toLowerCase() === normalized.toLowerCase());
  if (!exists) {
    await userRecord.update({ evmAddresses: [...list, normalized] });
  }
}

async function registerCampaignParticipant({
  req,
  campaign,
  campaignConfig,
  user,
  userRecord = null,
  contact,
  registrationUrl = null,
  registrationSource,
  registrationClient,
  registrationMetadata = {},
  cooldownKey = null,
  updateUserEvmAddress = false,
  notifyInitialize = true,
} = {}) {
  const normalizedCampaign = normalizeCampaignIdentifier(campaign);
  if (!normalizedCampaign) throw campaignRegistrationError("CAMPAIGN_REQUIRED", 400, "campaign is required");
  if (!user?.xHuntUserId) throw campaignRegistrationError("USER_REQUIRED", 401, "User is required");
  if (!user?.twitterId) throw campaignRegistrationError("INVALID_TWITTER_ID", 400, "Invalid Twitter ID");

  const normalizedContact = contact?.hasEmail !== undefined ? contact : normalizeRegistrationContact(contact);
  validateRegistrationContact(campaignConfig, normalizedContact);
  await validateRegistrationCooldown(req?.redisClient, cooldownKey);
  await validateCampaignThreshold(campaignConfig, user.twitterId);
  await validateTwitterProfileQuality(req, user.twitterId);
  await assertUniqueRegistrationContact(normalizedCampaign, normalizedContact);

  const existing = await findExistingCampaignRegistration(normalizedCampaign, user);
  if (existing) {
    throw campaignRegistrationError("ALREADY_REGISTERED", 409, "You have already registered for this campaign", existing);
  }

  const record = await CampaignRegistration.create({
    campaign: normalizedCampaign,
    xHuntUserId: user.xHuntUserId,
    authCenterUserId: user.authCenterUserId || null,
    twitterId: user.twitterId,
    username: user.username || null,
    displayName: user.displayName || null,
    avatar: user.avatar || null,
    invitedByCode: null,
    invitedByUserId: null,
    invitedByTwitterId: null,
    invitedByUsername: null,
    invitedByUserInfo: null,
    evmAddress: normalizedContact.evmAddress || null,
    email: normalizedContact.email || null,
    registrationUrl,
    registrationSource,
    registrationClient,
    registrationMetadata,
  });

  if (updateUserEvmAddress && normalizedContact.evmAddress) {
    await updateEvmAddressOnUser(userRecord, normalizedContact.evmAddress);
  }

  if (notifyInitialize) {
    notifyInitializeCampaign(req?.redisClient, normalizedCampaign).catch(() => {});
  }

  return { registration: record, contact: normalizedContact };
}

module.exports = {
  RANK_API_BY_DOMAIN,
  campaignRegistrationError,
  normalizeCampaignIdentifier,
  normalizeRegistrationEmail,
  isValidRegistrationEmail,
  normalizeTesterHandle,
  isCampaignTester,
  normalizeDisplayDomain,
  getCampaignDisplayDomains,
  matchesDisplayDomain,
  normalizeCreatorAuthPayload,
  rankResultMeetsThreshold,
  fetchCampaignRankByDomain,
  evaluateRankEligibility,
  validateCampaignThreshold,
  validateTwitterProfileQuality,
  normalizeRegistrationContact,
  validateRegistrationContact,
  loadCampaignConfigForRegistration,
  registerCampaignParticipant,
  notifyInitializeCampaign,
};
