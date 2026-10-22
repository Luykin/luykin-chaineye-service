const express = require("express");
const XLSX = require("xlsx");
const { adminAuth, requireRole, requirePermission } = require("../middleware/adminAuth");
const service = require("./service");
const { createDbAdminAudit } = require("./audit");
const { createHttpError } = require("./errors");
const {
  getAdminGrantedTableAccess,
  grantTableAccess,
  listTableGrantManagementData,
  normalizeDatabaseKey,
  normalizeTableKey,
  revokeTableAccess,
} = require("./access");
const {
  getDbAdminWebAuthnStatus,
  createDbAdminWebAuthnOptions,
  verifyDbAdminWebAuthn,
  requireDbAdminWebAuthn,
} = require("./webauthn");

const router = express.Router();

async function requireDbAdminEntry(req, res, next) {
  try {
    if (req.adminUser?.role === "super") return next();
    const tableAccess = await getAdminGrantedTableAccess(req.adminUser?.id);
    if (!tableAccess.size) {
      return res.status(403).json({ success: false, error: "未授权查看任何数据表" });
    }
    req.dbAdminDelegatedAccess = tableAccess;
    return next();
  } catch (error) {
    return sendError(res, error);
  }
}

function assertReadAccess(req, dbKey, tableKey = null) {
  const resolvedDbKey = service.resolveDbKey(dbKey);
  if (req.adminUser?.role === "super") return resolvedDbKey;
  const tableKeys = req.dbAdminDelegatedAccess?.get(resolvedDbKey);
  if (!tableKeys) {
    throw createHttpError(403, "未授权查看该数据库");
  }
  if (tableKey && !tableKeys.has(tableKey)) {
    throw createHttpError(403, "未授权查看该数据表");
  }
  return resolvedDbKey;
}

function sanitizeExcelValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^\s*[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function isDelegatedDbAdminRequest(req) {
  return req.adminUser?.role !== "super";
}

function tableForRequest(req, table) {
  if (!isDelegatedDbAdminRequest(req)) return table;
  return {
    ...table,
    allowCreate: false,
    allowUpdate: false,
    allowDelete: false,
  };
}

function tablesForRequest(req, dbKey, tables) {
  if (!isDelegatedDbAdminRequest(req)) return tables;
  const tableKeys = req.dbAdminDelegatedAccess.get(dbKey);
  return tables
    .filter((table) => tableKeys.has(table.key))
    .map((table) => tableForRequest(req, table));
}

function databasesForRequest(req, data) {
  if (!isDelegatedDbAdminRequest(req)) return data;
  const databases = data.databases
    .filter((database) => req.dbAdminDelegatedAccess.has(database.key))
    .map((database) => ({
      key: database.key,
      name: database.name,
      label: database.label,
      description: database.description,
      readOnly: true,
      schema: database.schema,
      configurableCredentials: false,
    }));
  return {
    ...data,
    databases,
    defaultDatabase: databases[0]?.key || "",
  };
}

const entryGuard = [adminAuth, requireDbAdminEntry];
const readGuard = [adminAuth, requireDbAdminEntry, requireDbAdminWebAuthn];
const writeGuard = [adminAuth, requireRole("super"), requirePermission("db-admin:write"), requireDbAdminWebAuthn];
const accessManagementGuard = [adminAuth, requireRole("super"), requireDbAdminWebAuthn];

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
    const dbKey = assertReadAccess(req, req.query?.db);
    const data = tablesForRequest(req, dbKey, await service.listTables(dbKey));
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/databases", readGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = databasesForRequest(req, await service.listDatabases());
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/databases/:dbKey/credentials", accessManagementGuard, express.json(), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await service.saveDatabaseCredentials(req.params.dbKey, req.body || {});
    await createDbAdminAudit(req, "db-admin-save-credentials", true, {
      database: req.params.dbKey,
      username: data.username,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-save-credentials", false, {
      database: req.params.dbKey,
      username: req.body?.username,
      error: error.message,
    });
    return sendError(res, error);
  }
});

router.get("/tables/:key/schema", readGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const dbKey = assertReadAccess(req, req.query?.db, req.params.key);
    const data = tableForRequest(req, await service.getTableSchema(req.params.key, dbKey));
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/tables/:key/rows", readGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const dbKey = assertReadAccess(req, req.query?.db, req.params.key);
    const result = await service.listRows(req.params.key, req.query || {}, dbKey);
    const data = { ...result, table: tableForRequest(req, result.table) };
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/tables/:key/export", readGuard, async (req, res) => {
  try {
    const dbKey = assertReadAccess(req, req.query?.db, req.params.key);
    const data = await service.exportRows(req.params.key, req.query || {}, dbKey);
    const excelRows = data.rows.map((row) => Object.fromEntries(
      data.columnNames.map((columnName) => [columnName, sanitizeExcelValue(row[columnName])])
    ));
    const worksheet = XLSX.utils.json_to_sheet(excelRows, { header: data.columnNames });
    const workbook = XLSX.utils.book_new();
    const sheetName = String(data.table.table || "data").replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "data";
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const baseName = `${dbKey}_${String(data.table.table || req.params.key)}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const filename = `${baseName}_${timestamp}.xlsx`;

    await createDbAdminAudit(req, "db-admin-export", true, {
      database: dbKey,
      tableKey: req.params.key,
      rowCount: data.total,
      search: req.query?.q || null,
    });
    res.set("Cache-Control", "no-store");
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return res.send(buffer);
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-export", false, {
      database: req.query?.db || "",
      tableKey: req.params.key,
      error: error.message,
    });
    return sendError(res, error);
  }
});

router.get("/access-grants", accessManagementGuard, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await listTableGrantManagementData();
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/access-grants", accessManagementGuard, express.json(), async (req, res) => {
  try {
    const databaseKey = service.resolveDbKey(normalizeDatabaseKey(req.body?.databaseKey));
    const tableKey = normalizeTableKey(req.body?.tableKey);
    await service.getTableSchema(tableKey, databaseKey);
    const result = await grantTableAccess({
      adminId: req.body?.adminId,
      databaseKey,
      tableKey,
      grantedByAdminId: req.adminUser.id,
    });
    await createDbAdminAudit(req, "db-admin-table-access-grant", true, {
      database: databaseKey,
      tableKey,
      targetAdminId: Number(req.body?.adminId),
      created: result.created,
    });
    return res.json({ success: true, data: { id: result.grant.id, created: result.created } });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-table-access-grant", false, {
      database: req.body?.databaseKey,
      tableKey: req.body?.tableKey,
      targetAdminId: req.body?.adminId,
      error: error.message,
    });
    return sendError(res, error);
  }
});

router.delete("/access-grants/:id", accessManagementGuard, async (req, res) => {
  try {
    const revoked = await revokeTableAccess(req.params.id);
    await createDbAdminAudit(req, "db-admin-table-access-revoke", true, {
      database: revoked.databaseKey,
      tableKey: revoked.tableKey,
      targetAdminId: revoked.adminId,
    });
    return res.json({ success: true, data: { id: revoked.id } });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-table-access-revoke", false, {
      grantId: req.params.id,
      error: error.message,
    });
    return sendError(res, error);
  }
});

router.post("/tables/:key/rows", writeGuard, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const dbKey = req.query?.db;
    const data = await service.createRow(req.params.key, req.body || {}, dbKey);
    await createDbAdminAudit(req, "db-admin-create", true, {
      database: service.resolveDbKey(dbKey),
      tableKey: req.params.key,
      primaryKey: data.row?.[data.table.primaryKey],
      changedColumns: data.changedColumns,
      after: data.row,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-create", false, {
      database: req.query?.db || "luykindatabase",
      tableKey: req.params.key,
      error: error.message,
      inputColumns: Object.keys(req.body || {}),
    });
    return sendError(res, error);
  }
});

router.patch("/tables/:key/rows/:id", writeGuard, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const dbKey = req.query?.db;
    const data = await service.updateRow(req.params.key, req.params.id, req.body || {}, dbKey);
    await createDbAdminAudit(req, "db-admin-update", true, {
      database: service.resolveDbKey(dbKey),
      tableKey: req.params.key,
      primaryKey: req.params.id,
      changedColumns: data.changedColumns,
      before: data.before,
      after: data.row,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-update", false, {
      database: req.query?.db || "luykindatabase",
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
    const dbKey = req.query?.db;
    const data = await service.deleteRow(req.params.key, req.params.id, dbKey);
    await createDbAdminAudit(req, "db-admin-delete", true, {
      database: service.resolveDbKey(dbKey),
      tableKey: req.params.key,
      primaryKey: req.params.id,
      before: data.row,
    });
    return res.json({ success: true, data });
  } catch (error) {
    await createDbAdminAudit(req, "db-admin-delete", false, {
      database: req.query?.db || "luykindatabase",
      tableKey: req.params.key,
      primaryKey: req.params.id,
      error: error.message,
    });
    return sendError(res, error);
  }
});

module.exports = router;
