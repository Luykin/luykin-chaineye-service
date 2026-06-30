const express = require("express");
const { adminAuth, requireRole, requirePermission } = require("../middleware/adminAuth");
const service = require("./service");
const { createDbAdminAudit } = require("./audit");
const {
  getDbAdminWebAuthnStatus,
  createDbAdminWebAuthnOptions,
  verifyDbAdminWebAuthn,
  requireDbAdminWebAuthn,
} = require("./webauthn");

const router = express.Router();

const entryGuard = [adminAuth, requireRole("super"), requirePermission(["db-admin:read", "db-admin:write"])];
const readGuard = [adminAuth, requireRole("super"), requirePermission("db-admin:read"), requireDbAdminWebAuthn];
const writeGuard = [adminAuth, requireRole("super"), requirePermission("db-admin:write"), requireDbAdminWebAuthn];

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error("[db-admin] error:", error);
  }
  return res.status(statusCode).json({
    success: false,
    error: error.message || "DB Admin 操作失败",
  });
}


router.get("/webauthn/status", entryGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await getDbAdminWebAuthnStatus(req, req.adminUser);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/webauthn/options", entryGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const options = await createDbAdminWebAuthnOptions(req, req.adminUser);
    return res.json({ success: true, options });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "生成 DB Admin 指纹认证参数失败",
      code: error.code,
    });
  }
});

router.post("/webauthn/verify", entryGuard, express.json(), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await verifyDbAdminWebAuthn(req, req.adminUser, req.body?.assertion);
    await createDbAdminAudit(req, "db-admin-webauthn-reauth", true, {
      tableKey: "__db_admin__",
      primaryKey: req.adminUser.id,
      expiresInSeconds: data.expiresInSeconds,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-webauthn-reauth", false, {
      tableKey: "__db_admin__",
      primaryKey: req.adminUser?.id,
      error: error.message,
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "DB Admin 指纹认证失败",
      code: error.code,
    });
  }
});

router.get("/tables", readGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await service.listTables();
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/tables/:key/schema", readGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await service.getTableSchema(req.params.key);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/tables/:key/rows", readGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await service.listRows(req.params.key, req.query || {});
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/tables/:key/rows", writeGuard, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const data = await service.createRow(req.params.key, req.body || {});
    await createDbAdminAudit(req, "db-admin-create", true, {
      tableKey: req.params.key,
      primaryKey: data.row?.[data.table.primaryKey],
      changedColumns: data.changedColumns,
      after: data.row,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-create", false, {
      tableKey: req.params.key,
      error: error.message,
      inputColumns: Object.keys(req.body || {}),
    });
    return sendError(res, error);
  }
});

router.patch("/tables/:key/rows/:id", writeGuard, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const data = await service.updateRow(req.params.key, req.params.id, req.body || {});
    await createDbAdminAudit(req, "db-admin-update", true, {
      tableKey: req.params.key,
      primaryKey: req.params.id,
      changedColumns: data.changedColumns,
      before: data.before,
      after: data.row,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-update", false, {
      tableKey: req.params.key,
      primaryKey: req.params.id,
      error: error.message,
      inputColumns: Object.keys(req.body || {}),
    });
    return sendError(res, error);
  }
});

router.delete("/tables/:key/rows/:id", writeGuard, async (req, res) => {
  try {
    const data = await service.deleteRow(req.params.key, req.params.id);
    await createDbAdminAudit(req, "db-admin-delete", true, {
      tableKey: req.params.key,
      primaryKey: req.params.id,
      before: data.row,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-delete", false, {
      tableKey: req.params.key,
      primaryKey: req.params.id,
      error: error.message,
    });
    return sendError(res, error);
  }
});

module.exports = router;
