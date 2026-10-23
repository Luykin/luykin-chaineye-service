const express = require("express");
const { XhuntAdminAuditLog } = require("../../models/postgres-start");
const { adminAuth, requirePermission, requireRole } = require("../middleware/adminAuth");
const {
  beginAdminTotpSetup,
  finishAdminTotpSetup,
  getAdminTotpStatus,
  verifyAdminTotp,
} = require("./security");

const PAGE_CONFIGS = {
  "server-command": {
    permission: "server:execute",
    role: "super",
    ttlSeconds: Math.max(
      60,
      parseInt(process.env.ADMIN_SERVER_COMMAND_TOTP_TTL_SECONDS || "600", 10) || 600,
    ),
  },
  "log-search": {
    permission: ["log-search:read", "error-logs:read"],
    ttlSeconds: Math.max(
      60,
      parseInt(process.env.ADMIN_LOG_SEARCH_TOTP_TTL_SECONDS || "600", 10) || 600,
    ),
  },
  "nacos-admin": {
    permission: "nacos-admin",
    role: "super",
    ttlSeconds: Math.max(
      60,
      parseInt(process.env.ADMIN_NACOS_ADMIN_TOTP_TTL_SECONDS || "600", 10) || 600,
    ),
  },
};

const router = express.Router();

function getPageConfig(scope) {
  const config = PAGE_CONFIGS[scope];
  if (!config) throw new Error(`Unsupported Authenticator scope: ${scope}`);
  return config;
}

async function writeAudit(req, action, success, message = null) {
  try {
    await XhuntAdminAuditLog.create({
      adminId: req.adminUser?.id || null,
      email: req.adminUser?.email || null,
      action,
      route: req.originalUrl || req.path,
      method: req.method,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      success,
      message,
    });
  } catch (_) {}
}

function sendError(res, error, fallbackMessage) {
  return res.status(error.statusCode || 500).json({
    success: false,
    code: error.code,
    error: error.message || fallbackMessage,
  });
}

function requireSensitivePageTotp(scope) {
  const { ttlSeconds } = getPageConfig(scope);
  return async function requirePageTotp(req, res, next) {
    try {
      res.set("Cache-Control", "no-store");
      if (!req.adminUser?.id) {
        return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "请先登录" });
      }
      const status = await getAdminTotpStatus(req, req.adminUser, scope, ttlSeconds);
      if (!status.enrolled) {
        return res.status(403).json({
          success: false,
          code: "TOTP_NOT_ENROLLED",
          error: "请先绑定 Authenticator",
        });
      }
      if (!status.verified) {
        return res.status(403).json({
          success: false,
          code: "TOTP_REAUTH_REQUIRED",
          error: "请先完成 Authenticator 验证",
        });
      }
      return next();
    } catch (error) {
      console.error(`[${scope} totp] security check failed:`, error);
      return res.status(500).json({ success: false, error: "检查 Authenticator 验证状态失败" });
    }
  };
}

function registerScopeRoutes(scope) {
  const config = getPageConfig(scope);
  const accessGuards = [
    adminAuth,
    ...(config.role ? [requireRole(config.role)] : []),
    requirePermission(config.permission),
  ];
  const prefix = `/${scope}`;

  router.get(`${prefix}/status`, ...accessGuards, async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const data = await getAdminTotpStatus(req, req.adminUser, scope, config.ttlSeconds);
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, "加载 Authenticator 验证状态失败");
    }
  });

  router.post(`${prefix}/setup`, ...accessGuards, async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const data = await beginAdminTotpSetup(req, req.adminUser, scope);
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, "生成 Authenticator 绑定信息失败");
    }
  });

  router.post(`${prefix}/setup/verify`, ...accessGuards, express.json(), async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const data = await finishAdminTotpSetup(
        req,
        req.adminUser,
        req.body?.code,
        scope,
        config.ttlSeconds,
      );
      await writeAudit(req, `${scope}-totp-enroll`, true);
      return res.json({ success: true, data });
    } catch (error) {
      await writeAudit(req, `${scope}-totp-enroll`, false, error.message);
      return sendError(res, error, "绑定 Authenticator 失败");
    }
  });

  router.post(`${prefix}/verify`, ...accessGuards, express.json(), async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const data = await verifyAdminTotp(
        req,
        req.adminUser,
        req.body?.code,
        scope,
        config.ttlSeconds,
      );
      await writeAudit(req, `${scope}-totp-reauth`, true);
      return res.json({ success: true, data });
    } catch (error) {
      await writeAudit(req, `${scope}-totp-reauth`, false, error.message);
      return sendError(res, error, "Authenticator 验证失败");
    }
  });
}

Object.keys(PAGE_CONFIGS).forEach(registerScopeRoutes);

module.exports = {
  PAGE_CONFIGS,
  requireSensitivePageTotp,
  sensitivePageTotpRouter: router,
};
