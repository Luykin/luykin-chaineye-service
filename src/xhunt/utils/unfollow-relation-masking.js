const { getVersionFromRequest, compareVersion } = require("./version");
const { isRequestXHuntVip } = require("../constants/xhuntVip");
const { getNacosConfigContent } = require("../services/nacosConfigClient");
const localNacosConfig = require("../constants/nacos_config.json");

// 新逻辑版本门槛：仅 x-extension-version > 0.4.5 走 3 天裁剪逻辑
const UNFOLLOW_RELATION_NEW_RULE_VERSION = "0.4.5";

// 非 VIP 遮挡时间窗口：近 3 天
const UNFOLLOW_RELATION_MASK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Nacos 配置来源（默认读取主配置 xhunt_config 中的 unfollowVipCta）
const NACOS_DATA_ID =
  process.env.UNFOLLOW_VIP_CTA_NACOS_DATA_ID || "xhunt_config";
const NACOS_GROUP =
  process.env.UNFOLLOW_VIP_CTA_NACOS_GROUP || "DEFAULT_GROUP";
const NACOS_CACHE_TTL_MS = Number.isFinite(
  Number(process.env.UNFOLLOW_VIP_CTA_CACHE_TTL_MS)
)
  ? Math.max(5_000, Number(process.env.UNFOLLOW_VIP_CTA_CACHE_TTL_MS))
  : 60_000;

const DEFAULT_VIP_CTA_LABEL = {
  zh: "申请 VIP 权限",
  en: "Apply for VIP Access",
};

let ctaCache = {
  expireAt: 0,
  value: null,
  inflight: null,
};

function parseVipCtaFromConfigObject(configObj) {
  if (!configObj || typeof configObj !== "object" || Array.isArray(configObj)) {
    return null;
  }

  const rawCta = configObj.unfollowVipCta;
  const fallbackUrl =
    configObj.unfollowVipCtaUrl ?? configObj.unfollowVipApplyUrl ?? "";

  if (typeof rawCta === "string") {
    return {
      url: rawCta.trim(),
      label: { ...DEFAULT_VIP_CTA_LABEL },
    };
  }

  if (rawCta && typeof rawCta === "object" && !Array.isArray(rawCta)) {
    const rawLabel =
      rawCta.label && typeof rawCta.label === "object" ? rawCta.label : {};
    const url = String(rawCta.url ?? fallbackUrl ?? "").trim();
    const zh = String(
      rawLabel.zh ?? rawCta.labelZh ?? DEFAULT_VIP_CTA_LABEL.zh
    ).trim();
    const en = String(
      rawLabel.en ?? rawCta.labelEn ?? DEFAULT_VIP_CTA_LABEL.en
    ).trim();

    return {
      url,
      label: {
        zh: zh || DEFAULT_VIP_CTA_LABEL.zh,
        en: en || DEFAULT_VIP_CTA_LABEL.en,
      },
    };
  }

  if (typeof fallbackUrl === "string" && fallbackUrl.trim()) {
    return {
      url: fallbackUrl.trim(),
      label: { ...DEFAULT_VIP_CTA_LABEL },
    };
  }

  return null;
}

function getFallbackVipCta() {
  const fromLocalFile = parseVipCtaFromConfigObject(localNacosConfig);

  const url =
    process.env.UNFOLLOW_VIP_CTA_URL !== undefined
      ? String(process.env.UNFOLLOW_VIP_CTA_URL).trim()
      : fromLocalFile?.url ?? "";

  const zh =
    process.env.UNFOLLOW_VIP_CTA_LABEL_ZH !== undefined
      ? String(process.env.UNFOLLOW_VIP_CTA_LABEL_ZH).trim()
      : fromLocalFile?.label?.zh ?? DEFAULT_VIP_CTA_LABEL.zh;

  const en =
    process.env.UNFOLLOW_VIP_CTA_LABEL_EN !== undefined
      ? String(process.env.UNFOLLOW_VIP_CTA_LABEL_EN).trim()
      : fromLocalFile?.label?.en ?? DEFAULT_VIP_CTA_LABEL.en;

  return {
    url,
    label: {
      zh: zh || DEFAULT_VIP_CTA_LABEL.zh,
      en: en || DEFAULT_VIP_CTA_LABEL.en,
    },
  };
}

async function getUnfollowVipCta(options = {}) {
  const now = Date.now();
  if (!options.force && ctaCache.value && now < ctaCache.expireAt) {
    return ctaCache.value;
  }

  if (!options.force && ctaCache.inflight) {
    return ctaCache.inflight;
  }

  ctaCache.inflight = (async () => {
    try {
      const content = await getNacosConfigContent({
        dataId: NACOS_DATA_ID,
        group: NACOS_GROUP,
        timeout: 3000,
      });
      const parsed =
        typeof content === "string" ? JSON.parse(content || "{}") : content;
      const resolved =
        parseVipCtaFromConfigObject(parsed) || getFallbackVipCta();
      ctaCache.value = resolved;
      ctaCache.expireAt = Date.now() + NACOS_CACHE_TTL_MS;
      return resolved;
    } catch (err) {
      const fallback = ctaCache.value || getFallbackVipCta();
      ctaCache.value = fallback;
      ctaCache.expireAt = Date.now() + Math.min(NACOS_CACHE_TTL_MS, 15_000);
      return fallback;
    } finally {
      ctaCache.inflight = null;
    }
  })();

  return ctaCache.inflight;
}

function clearUnfollowVipCtaCache() {
  ctaCache = {
    expireAt: 0,
    value: null,
    inflight: null,
  };
}

function isUnfollowRelationNewLogic(req) {
  const version = getVersionFromRequest(req);
  return compareVersion(version, UNFOLLOW_RELATION_NEW_RULE_VERSION) > 0;
}

function isRequestVipSafe(req) {
  try {
    return Boolean(isRequestXHuntVip(req));
  } catch (_) {
    return false;
  }
}

/**
 * 老版本插件（≤ 0.4.5 或无版本头）且非 VIP 时，维持原有拦截行为直接返回空数据
 */
function shouldBlockLegacyUnfollowRelation(req) {
  if (isUnfollowRelationNewLogic(req)) {
    return false;
  }
  return !isRequestVipSafe(req);
}

/**
 * 裁剪非 VIP 用户的近 3 天取关记录，并同步过滤 twitter_users、注入 vip_cta
 */
function maskUnfollowRelationForNonVip(payload, vipCta) {
  const inner = payload?.data?.data;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
    return payload;
  }

  const cutoff = Date.now() - UNFOLLOW_RELATION_MASK_WINDOW_MS;
  const isOlderThanCutoff = (item) => {
    if (!item || !item.created_at) return false;
    const ts = Date.parse(item.created_at);
    return Number.isFinite(ts) && ts < cutoff;
  };

  const rawUnfollowed = Array.isArray(inner.unfollowed_action)
    ? inner.unfollowed_action
    : null;
  const rawUnfollowing = Array.isArray(inner.unfollowing_action)
    ? inner.unfollowing_action
    : null;

  const keptUnfollowed = rawUnfollowed
    ? rawUnfollowed.filter(isOlderThanCutoff)
    : [];
  const keptUnfollowing = rawUnfollowing
    ? rawUnfollowing.filter(isOlderThanCutoff)
    : [];

  const maskedUnfollowedCount = rawUnfollowed
    ? rawUnfollowed.length - keptUnfollowed.length
    : 0;
  const maskedUnfollowingCount = rawUnfollowing
    ? rawUnfollowing.length - keptUnfollowing.length
    : 0;

  if (rawUnfollowed) {
    inner.unfollowed_action = keptUnfollowed;
  }
  if (rawUnfollowing) {
    inner.unfollowing_action = keptUnfollowing;
  }

  if (
    inner.twitter_users &&
    typeof inner.twitter_users === "object" &&
    !Array.isArray(inner.twitter_users)
  ) {
    const allowedUserIds = new Set();
    for (const item of keptUnfollowed) {
      if (item?.follower_id !== undefined && item?.follower_id !== null) {
        allowedUserIds.add(String(item.follower_id));
      }
      if (item?.following_id !== undefined && item?.following_id !== null) {
        allowedUserIds.add(String(item.following_id));
      }
    }
    for (const item of keptUnfollowing) {
      if (item?.follower_id !== undefined && item?.follower_id !== null) {
        allowedUserIds.add(String(item.follower_id));
      }
      if (item?.following_id !== undefined && item?.following_id !== null) {
        allowedUserIds.add(String(item.following_id));
      }
    }

    const filteredUsers = {};
    for (const [uid, userObj] of Object.entries(inner.twitter_users)) {
      if (allowedUserIds.has(String(uid))) {
        filteredUsers[uid] = userObj;
      }
    }
    inner.twitter_users = filteredUsers;
  }

  inner.is_vip = false;
  inner.vip_masked = true;
  inner.masked_unfollowed_count = maskedUnfollowedCount;
  inner.masked_unfollowing_count = maskedUnfollowingCount;
  inner.vip_cta = vipCta || getFallbackVipCta();

  return payload;
}

/**
 * 代理响应转换入口：供 proxy.js 在 unfollow_relation 路由中调用
 */
async function applyUnfollowRelationMasking(req, payload) {
  if (!isUnfollowRelationNewLogic(req)) {
    return payload;
  }

  const isVip = isRequestVipSafe(req);
  if (isVip) {
    const inner = payload?.data?.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      inner.is_vip = true;
      inner.vip_masked = false;
    }
    return payload;
  }

  const vipCta = await getUnfollowVipCta();
  return maskUnfollowRelationForNonVip(payload, vipCta);
}

module.exports = {
  UNFOLLOW_RELATION_NEW_RULE_VERSION,
  UNFOLLOW_RELATION_MASK_WINDOW_MS,
  isUnfollowRelationNewLogic,
  shouldBlockLegacyUnfollowRelation,
  applyUnfollowRelationMasking,
  maskUnfollowRelationForNonVip,
  getUnfollowVipCta,
  clearUnfollowVipCtaCache,
};
