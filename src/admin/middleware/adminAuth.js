const jwt = require("jsonwebtoken");
const { XhuntAdminManager } = require("../../models/postgres-start");

const SESSION_TTL = parseInt(process.env.ADMIN_SESSION_TTL || "7200", 10); // seconds
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change-me";

function getSessionVersionKey(adminId) {
  return `admin:session-version:${adminId}`;
}

async function getAdminSessionVersion(req, adminId) {
  if (!req?.redisClient || !adminId) return 0;
  try {
    const raw = await req.redisClient.get(getSessionVersionKey(adminId));
    const value = Number(raw || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (error) {
    console.warn("[adminAuth] 读取 sessionVersion 失败:", error.message);
    return 0;
  }
}

async function bumpAdminSessionVersion(req, adminId) {
  if (!req?.redisClient || !adminId) return Date.now();
  try {
    const key = getSessionVersionKey(adminId);
    if (typeof req.redisClient.incr === "function") {
      return req.redisClient.incr(key);
    }
    const next = (await getAdminSessionVersion(req, adminId)) + 1;
    await req.redisClient.set(key, String(next));
    return next;
  } catch (error) {
    console.warn("[adminAuth] 更新 sessionVersion 失败:", error.message);
    return Date.now();
  }
}

function buildUnauthorizedResponse(req, res, status = 401) {
  const wantsJson = String(req.headers['accept'] || '').includes('application/json') ||
    String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
  if (wantsJson) return res.status(status).json({ success: false, error: status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED', needLogin: true });
  return res.status(status).send(renderLoginRedirect());
}

function normalizeCookieHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/^\./, "");
}

function getHeaderOriginHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return normalizeCookieHost(new URL(raw).hostname);
  } catch (_) {
    return "";
  }
}

function getRequestHost(req) {
  const originHost = getHeaderOriginHost(req?.headers?.origin);
  if (originHost) return originHost;

  const refererHost = getHeaderOriginHost(req?.headers?.referer || req?.headers?.referrer);
  if (refererHost) return refererHost;

  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0];
  return normalizeCookieHost(forwardedHost || req?.headers?.host || req?.hostname || "");
}

function getSessionCookieDomain(req) {
  const configuredDomain = normalizeCookieHost(process.env.ADMIN_COOKIE_DOMAIN);
  if (!configuredDomain) return undefined;

  const requestHost = getRequestHost(req);
  if (!requestHost) return configuredDomain;

  // Cookie Domain 只能设置为当前 host 或其父域。kb.xhunt.ai 不能写 Domain=kb.cryptohunt.ai；
  // 这种情况退回 host-only cookie，让两个后台域名各自维护自己的 admin session。
  if (requestHost === configuredDomain || requestHost.endsWith(`.${configuredDomain}`)) {
    return process.env.ADMIN_COOKIE_DOMAIN;
  }
  return undefined;
}

function buildSessionCookieOptions(req, overrides = {}) {
  const secure = (process.env.ADMIN_COOKIE_SECURE || "false").toLowerCase() === "true";
  const domain = getSessionCookieDomain(req);
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    domain,
    path: "/",
    ...overrides,
  };
}

function setSessionCookie(res, payload, req = null) {
  const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_TTL });
  res.cookie(cookieName, token, buildSessionCookieOptions(req, {
    maxAge: SESSION_TTL * 1000,
  }));
}

function clearSessionCookie(res, req = null) {
  const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
  res.cookie(cookieName, "", buildSessionCookieOptions(req, {
    expires: new Date(0),
  }));
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const [k, ...v] = p.trim().split('=');
    out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function adminAuth(req, res, next) {
  try {
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const cookies = req.cookies || parseCookies(req.headers.cookie || "");
    const token = cookies[cookieName];
    if (!token) {
      return buildUnauthorizedResponse(req, res, 401);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return buildUnauthorizedResponse(req, res, 401);
    }

    const admin = await XhuntAdminManager.findByPk(decoded.id);
    if (!admin || !admin.isActive || !admin.canLogin) {
      return buildUnauthorizedResponse(req, res, 403);
    }

    const currentSessionVersion = await getAdminSessionVersion(req, admin.id);
    const tokenSessionVersion = Number(decoded.sessionVersion || 0);
    if (currentSessionVersion > 0 && tokenSessionVersion !== currentSessionVersion) {
      clearSessionCookie(res, req);
      return buildUnauthorizedResponse(req, res, 401);
    }

    // 载入权限：仅使用 DB 字段；为空则表示无任何细粒度权限
    let permissions = Array.isArray(admin.permissions) ? admin.permissions : [];

    // Sliding expiration: re-issue cookie on each valid request
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email, sessionVersion: tokenSessionVersion }, req);

    // 注入兼容对象与权限，供管理后台 API 权限判断使用
    req.adminUser = admin;
    req.adminPermissions = permissions;
    req.user = {
      username: admin.email,
      role: admin.role === "super" ? "super" : "admin",
      name: admin.email,
      permissions,
    };

    next();
  } catch (err) {
    console.error("[adminAuth] error:", err);
    return res.status(500).send("Internal error");
  }
}

function requireRole(required) {
  return function (req, res, next) {
    const role = req.adminUser?.role;
    if (role === "super") return next();
    if (required === "admin" && role === "admin") return next();
    return res.status(403).json({ success: false, error: "权限不足" });
  };
}

function requirePermission(perm) {
  return function (req, res, next) {
    if (req.adminUser?.role === "super") return next();
    const perms = req.adminPermissions || [];
    if (perms.includes("*")) return next();
    const allowed = Array.isArray(perm) ? perm.some((p) => perms.includes(p)) : perms.includes(perm);
    if (allowed) return next();
    return res.status(403).json({ success: false, error: "权限不足", required: perm });
  };
}

function renderLoginRedirect() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><script>location.replace('/api/xhunt/stats#/login')</script><style>body{background:#f8fafc;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,-apple-system,sans-serif;color:#64748b}</style></head><body>会话已过期，正在跳转...</body></html>`;
}

module.exports = { adminAuth, requireRole, requirePermission, setSessionCookie, clearSessionCookie, bumpAdminSessionVersion };
