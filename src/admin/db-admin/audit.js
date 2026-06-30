const { XhuntAdminAuditLog } = require("../../models/postgres-start");

function stringifyForAudit(value, maxLength = 8000) {
  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch (_) {
    const text = String(value || "");
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }
}

async function createDbAdminAudit(req, action, success, detail = {}) {
  try {
    const admin = req.adminUser || {};
    const message = stringifyForAudit({
      tableKey: detail.tableKey,
      primaryKey: detail.primaryKey,
      error: detail.error,
    }, 500);

    await XhuntAdminAuditLog.create({
      adminId: admin.id || null,
      email: admin.email || null,
      action,
      route: req.originalUrl || req.url || "",
      method: req.method,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      payload: stringifyForAudit(detail),
      success: !!success,
      message,
    });
  } catch (error) {
    console.warn("[db-admin] audit failed:", error?.message || error);
  }
}

module.exports = {
  createDbAdminAudit,
};
