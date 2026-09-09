const { XhuntAdminAuditLog } = require("../../models/postgres-start");

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function writeAdminAudit(req, { action, success, message, payload = null }) {
  try {
    const admin = req.adminUser || req.user;
    if (!admin?.id) return;

    await XhuntAdminAuditLog.create({
      adminId: admin.id,
      email: admin.email || admin.username || "unknown",
      action: truncate(action, 64),
      route: truncate(req.originalUrl || req.url || "", 256),
      method: truncate(req.method || "", 8),
      ip: truncate(req.headers["x-forwarded-for"] || req.ip || "", 64),
      userAgent: truncate(req.headers["user-agent"] || "", 512),
      payload: payload === null ? null : truncate(JSON.stringify(payload), 8000),
      success: Boolean(success),
      message: truncate(message, 512) || null,
    });
  } catch (error) {
    console.warn("[admin-audit] write failed:", error?.message || error);
  }
}

/**
 * Records selected high-risk endpoints once their response is complete.
 * The resolver must return null for read-only or otherwise non-audited routes.
 * Request bodies are deliberately never persisted here: some admin endpoints
 * accept credentials, prompts, or tokens.
 */
function createAdminWriteAudit(resolveAction) {
  return (req, res, next) => {
    const action = resolveAction(req);
    if (!action) return next();

    const startedAt = Date.now();
    res.once("finish", () => {
      void writeAdminAudit(req, {
        action,
        success: res.statusCode < 400,
        message: `status=${res.statusCode}, durationMs=${Date.now() - startedAt}`,
      });
    });
    return next();
  };
}

module.exports = {
  createAdminWriteAudit,
  writeAdminAudit,
};
