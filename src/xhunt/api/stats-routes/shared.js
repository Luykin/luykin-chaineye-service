const { XhuntAdminAuditLog } = require("../../../models/postgres-start");

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  } catch (e) {
    // 静默失败，避免影响主流程
  }
}

module.exports = {
  parseDateOrNull,
  logAdminAction,
};
