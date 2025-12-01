const jwt = require("jsonwebtoken");
const { XhuntAdminManager } = require("../../models/postgres-start");

const SESSION_TTL = parseInt(process.env.ADMIN_SESSION_TTL || "7200", 10); // seconds
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change-me";

function setSessionCookie(res, payload) {
  const secure = (process.env.ADMIN_COOKIE_SECURE || "false").toLowerCase() === "true";
  const domain = process.env.ADMIN_COOKIE_DOMAIN || undefined;
  const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_TTL });
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    domain,
    maxAge: SESSION_TTL * 1000,
    path: "/",
  });
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
    if (!token) return res.status(401).send(renderLoginRedirect());

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).send(renderLoginRedirect());
    }

    const admin = await XhuntAdminManager.findByPk(decoded.id);
    if (!admin || !admin.isActive || !admin.canLogin) {
      return res.status(403).send(renderLoginRedirect());
    }

    // 载入权限：仅使用 DB 字段；若为空则使用角色默认权限兜底
    let permissions = Array.isArray(admin.permissions) ? admin.permissions : [];

    // 角色默认权限（仅用于初始化/兜底，不做强制）
    if (!permissions || permissions.length === 0) {
      if (admin.role === "super") {
        permissions = ["*"]; // 全部
      } else {
        permissions = [
          "overview",
          "dau-details",
          "online-users",
        ];
      }
    }

    // Sliding expiration: re-issue cookie on each valid request
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email });

    // 注入兼容对象与权限，保持 stats.ejs 的 user 判断逻辑最小改动
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
    const perms = req.adminPermissions || [];
    if (perms.includes("*") || perms.includes(perm)) return next();
    return res.status(403).json({ success: false, error: "权限不足", required: perm });
  };
}

function renderLoginRedirect() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="0;url=/admin/login"/></head><body>Redirecting...</body></html>`;
}

module.exports = { adminAuth, requireRole, requirePermission, setSessionCookie };
