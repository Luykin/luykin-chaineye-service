const express = require("express");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const {
  XhuntAdminAuditLog,
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntClient,
  AuthCenterXhuntSession,
  XHuntUser,
  pgInstance,
} = require("../../models/postgres-start");
const { adminAuth, requirePermission, requireRole } = require("../../admin/middleware/adminAuth");
const {
  PROVIDERS,
  upsertOAuthIdentityLogin,
} = require("../auth-center/services/auth");
const { buildPublicUser } = require("../auth-center/services/display-name");
const { getIssuer } = require("../auth-center/services/token");
const { randomToken, sha256, getFingerprint, getIpHash } = require("../auth-center/services/utils");
const {
  syncCampaignsFromNacos,
  listPublicCampaigns,
  getPublicCampaignDetailBySlug,
  getWebsiteCampaignAdminByNacosId,
  saveManagedCampaignsConfig,
  saveWebsiteCampaignConfig,
  listAllWebsiteCampaignsAdmin,
  importLegacyWebsiteCampaigns,
  serializeWebsiteCampaignAdmin,
} = require("../services/websiteCampaignService");
const {
  invalidateCampaignConfigCache,
} = require("../utils/campaign-config-cache");
const {
  normalizePublicLang,
  normalizePublicSlug,
  getCachedPublicCampaigns,
  getCachedPublicCampaignDetail,
  invalidateWebsiteCampaignPublicCache,
} = require("../utils/website-campaign-public-cache");

const router = express.Router();
const ECHOHUNT_CLIENT_KEY = process.env.ECHOHUNT_AUTH_CLIENT_KEY || "echohunt";
const ECHOHUNT_DEBUG_TOKEN_TTL_SECONDS = 6 * 60 * 60;

function captureRawBody(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  } else {
    req.rawBody = "";
  }
}

router.use(express.json({ limit: "1mb", verify: captureRawBody }));

async function logAdminAction(req, { action, success, message }) {
  try {
    const admin = req.adminUser;
    if (!admin) return;
    await XhuntAdminAuditLog.create({
      adminId: admin.id,
      email: admin.email,
      action,
      route: req.originalUrl || req.path || "",
      method: req.method || "",
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      payload: req.method === "GET" ? null : JSON.stringify(req.body || {}),
      success: !!success,
      message: message || null,
    });
  } catch (_) {}
}

async function invalidatePluginCampaignConfigCache(req) {
  try {
    await invalidateCampaignConfigCache(req.redisClient);
  } catch (error) {
    console.warn("[WebsiteCampaigns] invalidate campaign config cache warn:", error.message || error);
  }
}

async function invalidateWebsiteCampaignCaches(req) {
  await Promise.all([
    invalidatePluginCampaignConfigCache(req),
    invalidateWebsiteCampaignPublicCache(req.redisClient),
  ]);
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required for auth center");
  }
  return process.env.JWT_SECRET;
}

function pickIdentity(identities, provider) {
  return (identities || []).find((item) => item.provider === provider) || null;
}

function buildEchohuntUserPayload(authUser, xhuntUser, twitterIdentity = null) {
  return {
    id: authUser?.id || null,
    xhuntUserId: xhuntUser?.id || authUser?.xhuntUserId || null,
    twitterId: twitterIdentity?.twitterId || authUser?.primaryTwitterId || xhuntUser?.twitterId || null,
    username: twitterIdentity?.username || xhuntUser?.username || null,
    displayName: twitterIdentity?.displayName || twitterIdentity?.username || xhuntUser?.displayName || null,
    avatar: twitterIdentity?.avatar || xhuntUser?.avatar || authUser?.avatar || null,
    userSource: xhuntUser?.userSource || null,
  };
}

function serializeEchohuntTokenUser(xhuntUser, authUser = null, identities = []) {
  const twitter = pickIdentity(identities, "twitter");
  return {
    id: xhuntUser.id,
    xhuntUserId: xhuntUser.id,
    authCenterUserId: authUser?.id || null,
    username: xhuntUser.username || twitter?.username || null,
    displayName: xhuntUser.displayName || twitter?.displayName || xhuntUser.username || null,
    avatar: xhuntUser.avatar || twitter?.avatar || authUser?.avatar || null,
    twitterId: xhuntUser.twitterId,
    twitterUsername: xhuntUser.username || twitter?.username || null,
    accountName: authUser?.accountName || null,
    providers: identities.map((item) => item.provider),
    status: authUser?.status || "xhunt_only",
    userSource: xhuntUser.userSource || null,
    lastLoginAt: authUser?.lastLoginAt || null,
    createdAt: xhuntUser.createdAt,
  };
}

async function mapAuthUsersForXHuntUsers(xhuntUsers) {
  const ids = xhuntUsers.map((item) => item.id).filter(Boolean);
  const twitterIds = xhuntUsers.map((item) => item.twitterId).filter(Boolean).map(String);
  if (!ids.length && !twitterIds.length) return new Map();

  const authUsers = await AuthCenterXhuntUser.findAll({
    where: {
      [Op.or]: [
        ids.length ? { xhuntUserId: { [Op.in]: ids } } : null,
        twitterIds.length ? { primaryTwitterId: { [Op.in]: twitterIds } } : null,
      ].filter(Boolean),
    },
    include: [{ model: AuthCenterXhuntIdentity, as: "identities" }],
  });

  const map = new Map();
  authUsers.forEach((authUser) => {
    if (authUser.xhuntUserId && !map.has(String(authUser.xhuntUserId))) {
      map.set(String(authUser.xhuntUserId), authUser);
    }
    if (authUser.primaryTwitterId) {
      const xhuntUser = xhuntUsers.find((item) => String(item.twitterId) === String(authUser.primaryTwitterId));
      if (xhuntUser && !map.has(String(xhuntUser.id))) {
        map.set(String(xhuntUser.id), authUser);
      }
    }
  });
  return map;
}

async function serializeXHuntTokenUsers(xhuntUsers) {
  const authMap = await mapAuthUsersForXHuntUsers(xhuntUsers);
  return xhuntUsers.map((xhuntUser) => {
    const authUser = authMap.get(String(xhuntUser.id)) || null;
    return serializeEchohuntTokenUser(xhuntUser, authUser, authUser?.identities || []);
  });
}

async function loadEchohuntTokenUsers(userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean).map(String))).slice(0, 20);
  if (!ids.length) return [];
  const users = await XHuntUser.findAll({
    where: { id: { [Op.in]: ids } },
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  users.sort((a, b) => (order.get(String(a.id)) ?? 999) - (order.get(String(b.id)) ?? 999));
  return serializeXHuntTokenUsers(users);
}

async function searchEchohuntTokenUsers(keyword) {
  const q = String(keyword || "").trim();
  if (!q) {
    const recentUsers = await XHuntUser.findAll({
      order: [["updatedAt", "DESC"], ["createdAt", "DESC"]],
      limit: 20,
    });
    return serializeXHuntTokenUsers(recentUsers);
  }

  const exactUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  const xhuntOr = [
    { twitterId: { [Op.iLike]: `%${q}%` } },
    { username: { [Op.iLike]: `%${q}%` } },
    { displayName: { [Op.iLike]: `%${q}%` } },
    { inviteCode: { [Op.iLike]: `%${q}%` } },
  ];
  if (exactUuid) {
    xhuntOr.push({ id: q });
  }

  const matchedXHuntUsers = await XHuntUser.findAll({
    where: { [Op.or]: xhuntOr },
    order: [["updatedAt", "DESC"], ["createdAt", "DESC"]],
    limit: 20,
  });

  const matchedAuthUsers = await AuthCenterXhuntUser.findAll({
    where: {
      [Op.or]: [
        { accountName: { [Op.iLike]: `%${q}%` } },
        { accountNameLower: { [Op.iLike]: `%${q.toLowerCase()}%` } },
        { displayName: { [Op.iLike]: `%${q}%` } },
        { primaryTwitterId: { [Op.iLike]: `%${q}%` } },
        exactUuid ? { id: q } : null,
        exactUuid ? { xhuntUserId: q } : null,
      ].filter(Boolean),
    },
    limit: 20,
  });

  const matchedIdentities = await AuthCenterXhuntIdentity.findAll({
    where: {
      [Op.or]: [
        { providerSubject: { [Op.iLike]: `%${q}%` } },
        { providerSubjectLower: { [Op.iLike]: `%${q.toLowerCase()}%` } },
        { username: { [Op.iLike]: `%${q}%` } },
        { displayName: { [Op.iLike]: `%${q}%` } },
        { email: { [Op.iLike]: `%${q}%` } },
      ],
    },
    limit: 30,
  });

  const linkedAuthIds = Array.from(new Set([
    ...matchedAuthUsers.map((item) => item.xhuntUserId).filter(Boolean),
  ]));
  const linkedTwitterIds = Array.from(new Set([
    ...matchedAuthUsers.map((item) => item.primaryTwitterId).filter(Boolean),
    ...matchedIdentities
      .filter((item) => item.provider === PROVIDERS.TWITTER)
      .map((item) => item.providerSubject)
      .filter(Boolean),
  ].map(String)));

  const linkedXHuntUsers = linkedAuthIds.length || linkedTwitterIds.length
    ? await XHuntUser.findAll({
        where: {
          [Op.or]: [
            linkedAuthIds.length ? { id: { [Op.in]: linkedAuthIds } } : null,
            linkedTwitterIds.length ? { twitterId: { [Op.in]: linkedTwitterIds } } : null,
          ].filter(Boolean),
        },
        limit: 20,
      })
    : [];

  const idSet = new Set();
  const combined = [];
  [...matchedXHuntUsers, ...linkedXHuntUsers].forEach((item) => {
    if (idSet.has(String(item.id))) return;
    idSet.add(String(item.id));
    combined.push(item);
  });
  return serializeXHuntTokenUsers(combined.slice(0, 20));
}

async function ensureAuthCenterUserForXHuntUser(xhuntUser, transaction) {
  if (!xhuntUser?.twitterId) {
    const err = new Error("XHuntUser 缺少 twitterId，无法创建 EchoHunt 登录态");
    err.status = 400;
    throw err;
  }

  const authModels = {
    AuthCenterXhuntUser,
    AuthCenterXhuntIdentity,
    XHuntUser,
  };
  const result = await upsertOAuthIdentityLogin(
    authModels,
    PROVIDERS.TWITTER,
    {
      providerSubject: String(xhuntUser.twitterId),
      providerSubjectLower: String(xhuntUser.twitterId).toLowerCase(),
      username: xhuntUser.username || null,
      displayName: xhuntUser.displayName || xhuntUser.username || null,
      avatar: xhuntUser.avatar || null,
    },
    transaction
  );

  await result.user.update(
    {
      xhuntUserId: xhuntUser.id,
      primaryTwitterId: String(xhuntUser.twitterId),
      avatar: xhuntUser.avatar || result.user.avatar,
    },
    { transaction }
  );
  result.user.xhuntUserId = xhuntUser.id;
  return result;
}

async function createEchohuntDebugSession(req, xhuntUser) {
  return pgInstance.transaction(async (transaction) => {
    const result = await ensureAuthCenterUserForXHuntUser(xhuntUser, transaction);
    const user = result.user;
    const identities = await AuthCenterXhuntIdentity.findAll({
      where: { userId: user.id },
      order: [["createdAt", "ASC"]],
      transaction,
    });
    const providers = identities.map((item) => item.provider);
    const twitter = pickIdentity(identities, "twitter");
    const client = await AuthCenterXhuntClient.findOne({
      where: { clientKey: ECHOHUNT_CLIENT_KEY, isActive: true },
      transaction,
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ECHOHUNT_DEBUG_TOKEN_TTL_SECONDS * 1000);
    const refreshToken = randomToken(48);
    const accessTokenJti = randomToken(16);
    const session = await AuthCenterXhuntSession.create(
      {
        userId: user.id,
        clientId: client?.id || null,
        clientKey: client?.clientKey || ECHOHUNT_CLIENT_KEY,
        refreshTokenHash: sha256(refreshToken),
        accessTokenJti,
        fingerprint: getFingerprint(req),
        userAgent: req.headers["user-agent"] || null,
        ipHash: getIpHash(req),
        lastUsedAt: now,
        expiresAt,
      },
      { transaction }
    );

    await xhuntUser.update(
      {
        lastLoginClient: "echohunt",
        userSource: xhuntUser.userSource === "echohunt_web" ? "echohunt_web" : "mixed",
        sourceMetadata: {
          ...(xhuntUser.sourceMetadata && typeof xhuntUser.sourceMetadata === "object" ? xhuntUser.sourceMetadata : {}),
          lastEchohuntDebugTokenAt: now.toISOString(),
          echohuntAuthCenterUserId: user.id,
        },
      },
      { transaction }
    );

    const accessToken = jwt.sign(
      {
        sub: user.id,
        sid: session.id,
        jti: accessTokenJti,
        aud: client?.clientKey || ECHOHUNT_CLIENT_KEY,
        iss: getIssuer(),
        xhuntUserId: xhuntUser.id,
        providers,
      },
      getJwtSecret(),
      { expiresIn: ECHOHUNT_DEBUG_TOKEN_TTL_SECONDS }
    );

    const twitterPayload = twitter
      ? {
          twitterId: twitter.providerSubject,
          username: twitter.username,
          displayName: twitter.displayName,
          avatar: twitter.avatar,
        }
      : {
          twitterId: xhuntUser.twitterId,
          username: xhuntUser.username,
          displayName: xhuntUser.displayName,
          avatar: xhuntUser.avatar,
        };
    const publicUser = buildPublicUser(user, identities);
    const storageValue = {
      token: {
        accessToken,
        refreshToken,
        expiresAt: expiresAt.getTime(),
        tokenType: "Bearer",
      },
      user: {
        ...publicUser,
        ...buildEchohuntUserPayload(user, xhuntUser, twitterPayload),
        isNewUser: !!result.isNewUser,
      },
    };

    return {
      storageKey: "echohunt_auth_session_v1",
      storageValue,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: ECHOHUNT_DEBUG_TOKEN_TTL_SECONDS,
    };
  });
}

router.get(
  "/internal/echohunt-token/users",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const users = await searchEchohuntTokenUsers(req.query.keyword);
      return res.json({ success: true, data: users });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message || "搜索用户失败" });
    }
  }
);

router.post(
  "/internal/echohunt-token/generate",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const userId = String(req.body?.xhuntUserId || req.body?.userId || "").trim();
      if (!userId) {
        return res.status(400).json({ success: false, error: "xhuntUserId 为必填字段" });
      }
      const xhuntUser = await XHuntUser.findByPk(userId);
      if (!xhuntUser) {
        return res.status(404).json({ success: false, error: "用户不存在" });
      }
      if (!xhuntUser.twitterId) {
        return res.status(400).json({ success: false, error: "XHuntUser 缺少 twitterId，无法生成 EchoHunt token" });
      }
      const data = await createEchohuntDebugSession(req, xhuntUser);
      await logAdminAction(req, {
        action: "echohunt-debug-token-generate",
        success: true,
        message: `xhuntUserId=${xhuntUser.id};twitterId=${xhuntUser.twitterId}`,
      });
      return res.json({ success: true, data });
    } catch (error) {
      await logAdminAction(req, {
        action: "echohunt-debug-token-generate",
        success: false,
        message: error.message || "生成失败",
      });
      return res.status(500).json({ success: false, error: error.message || "生成 EchoHunt 调试 token 失败" });
    }
  }
);

router.get("/internal/list-all", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const data = await listAllWebsiteCampaignsAdmin();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "读取网站活动列表失败" });
  }
});

router.post("/internal/import-legacy", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const summary = await importLegacyWebsiteCampaigns();
    await invalidateWebsiteCampaignCaches(req);
    await logAdminAction(req, {
      action: "website-campaign-import-legacy",
      success: true,
      message: JSON.stringify(summary),
    });
    return res.json({ success: true, summary });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-import-legacy",
      success: false,
      message: error.message || "导入旧活动失败",
    });
    return res.status(500).json({ success: false, error: error.message || "导入旧活动失败" });
  }
});

router.get("/internal/by-nacos-id/:nacosCampaignId", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const record = await getWebsiteCampaignAdminByNacosId(req.params.nacosCampaignId);
    return res.json({ success: true, data: record ? serializeWebsiteCampaignAdmin(record) : null });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "读取网站配置失败" });
  }
});

router.post("/internal/sync-from-nacos", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const dryRun = !!(req.body && req.body.dryRun);
    const result = await syncCampaignsFromNacos({ dryRun });
    if (!dryRun) {
      await invalidateWebsiteCampaignCaches(req);
    }
    await logAdminAction(req, {
      action: dryRun ? "website-campaign-sync-dry-run" : "website-campaign-sync",
      success: true,
      message: JSON.stringify(result.summary),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-sync",
      success: false,
      message: error.message || "同步失败",
    });
    return res.status(500).json({ success: false, error: error.message || "同步失败" });
  }
});

router.put("/internal/managed-config", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const summary = await saveManagedCampaignsConfig(req.body || {});
    await invalidateWebsiteCampaignCaches(req);
    await logAdminAction(req, {
      action: "website-campaign-save-managed-config",
      success: true,
      message: JSON.stringify(summary),
    });
    return res.json({ success: true, summary });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-save-managed-config",
      success: false,
      message: error.message || "保存失败",
    });
    return res.status(500).json({ success: false, error: error.message || "保存失败" });
  }
});

router.put("/internal/:nacosCampaignId/web-config", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const record = await saveWebsiteCampaignConfig(req.params.nacosCampaignId, req.body || {});
    await invalidateWebsiteCampaignCaches(req);
    await logAdminAction(req, {
      action: "website-campaign-save-config",
      success: true,
      message: `nacosCampaignId=${req.params.nacosCampaignId}`,
    });
    return res.json({
      success: true,
      data: {
        nacosCampaignId: record.nacosCampaignId,
        webStatus: record.webStatus,
        updatedAt: record.updatedAt,
      },
    });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-save-config",
      success: false,
      message: error.message || "保存失败",
    });
    const status = /先同步/.test(error.message || "") || /必须填写/.test(error.message || "") || /格式不正确/.test(error.message || "") || /slug 已被/.test(error.message || "") ? 400 : 500;
    return res.status(status).json({ success: false, error: error.message || "保存失败" });
  }
});

router.get("/", async (req, res) => {
  try {
    const lang = normalizePublicLang(req.query.lang);
    const data = await getCachedPublicCampaigns(req.redisClient, lang, () =>
      listPublicCampaigns({ lang })
    );
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "获取活动列表失败" });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const lang = normalizePublicLang(req.query.lang);
    const slug = normalizePublicSlug(req.params.slug);
    const data = await getCachedPublicCampaignDetail(req.redisClient, slug, lang, () =>
      getPublicCampaignDetailBySlug(slug, { lang })
    );
    if (!data) {
      return res.status(404).json({ success: false, error: "活动不存在" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "获取活动详情失败" });
  }
});

module.exports = router;
