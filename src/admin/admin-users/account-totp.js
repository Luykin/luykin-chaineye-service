const express = require("express");
const { XhuntAdminAuditLog } = require("../../models/postgres-start");
const { adminAuth } = require("../middleware/adminAuth");
const {
  beginAdminTotpSetup,
  finishAdminTotpSetup,
} = require("./security");

const ACCOUNT_TOTP_SCOPE = "account-settings";
const ACCOUNT_TOTP_TTL_SECONDS = 600;
const router = express.Router();

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

router.use(adminAuth);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/status", async (req, res) => {
  const enrolled = !!req.adminUser.totpSecretEncrypted && !!req.adminUser.totpEnabledAt;
  return res.json({
    success: true,
    data: {
      enrolled,
      enabledAt: enrolled ? req.adminUser.totpEnabledAt : null,
    },
  });
});

router.post("/setup", async (req, res) => {
  try {
    const data = await beginAdminTotpSetup(
      req,
      req.adminUser,
      ACCOUNT_TOTP_SCOPE,
      { allowReplace: true },
    );
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "生成 Authenticator 绑定信息失败");
  }
});

router.post("/setup/verify", express.json(), async (req, res) => {
  try {
    const data = await finishAdminTotpSetup(
      req,
      req.adminUser,
      req.body?.code,
      ACCOUNT_TOTP_SCOPE,
      ACCOUNT_TOTP_TTL_SECONDS,
      { allowReplace: true },
    );
    await writeAudit(req, data.replaced ? "account-totp-replace" : "account-totp-enroll", true);
    return res.json({ success: true, data });
  } catch (error) {
    await writeAudit(req, "account-totp-enroll-or-replace", false, error.message);
    return sendError(res, error, "绑定 Authenticator 失败");
  }
});

module.exports = router;
