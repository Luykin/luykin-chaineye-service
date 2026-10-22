const {
  XhuntAdminDbTableGrant,
  XhuntAdminManager,
} = require("../../models/postgres-start");
const { createHttpError } = require("./errors");

const DELEGATED_DB_ADMIN_PERMISSION = "db-admin:delegated-read";

function normalizeTableKey(value) {
  const tableKey = String(value || "").trim();
  if (!tableKey || tableKey.length > 255) {
    throw createHttpError(400, "请选择要授权的数据表");
  }
  return tableKey;
}

function normalizeDatabaseKey(value) {
  const databaseKey = String(value || "").trim();
  if (!databaseKey || databaseKey.length > 64) {
    throw createHttpError(400, "请选择要授权的数据库");
  }
  return databaseKey;
}

async function getAdminGrantedTableAccess(adminId) {
  const rows = await XhuntAdminDbTableGrant.findAll({
    where: { adminId },
    attributes: ["databaseKey", "tableKey"],
    raw: true,
  });
  return rows.reduce((access, row) => {
    if (!access.has(row.databaseKey)) access.set(row.databaseKey, new Set());
    access.get(row.databaseKey).add(row.tableKey);
    return access;
  }, new Map());
}

async function hasAnyAdminTableGrant(adminId) {
  if (!adminId) return false;
  const count = await XhuntAdminDbTableGrant.count({
    where: { adminId },
  });
  return count > 0;
}

async function listTableGrantManagementData() {
  const [admins, grants] = await Promise.all([
    XhuntAdminManager.findAll({
      where: { role: "admin" },
      attributes: ["id", "email", "role", "isActive", "canLogin"],
      order: [["email", "ASC"]],
      raw: true,
    }),
    XhuntAdminDbTableGrant.findAll({
      include: [
        { model: XhuntAdminManager, as: "admin", attributes: ["id", "email", "isActive", "canLogin"] },
        { model: XhuntAdminManager, as: "grantedByAdmin", attributes: ["id", "email"] },
      ],
      order: [["createdAt", "DESC"], ["id", "DESC"]],
    }),
  ]);

  return {
    admins,
    grants: grants.map((grant) => ({
      id: grant.id,
      adminId: grant.adminId,
      databaseKey: grant.databaseKey,
      tableKey: grant.tableKey,
      grantedByAdminId: grant.grantedByAdminId,
      createdAt: grant.createdAt,
      admin: grant.admin ? {
        id: grant.admin.id,
        email: grant.admin.email,
        isActive: grant.admin.isActive,
        canLogin: grant.admin.canLogin,
      } : null,
      grantedByAdmin: grant.grantedByAdmin ? {
        id: grant.grantedByAdmin.id,
        email: grant.grantedByAdmin.email,
      } : null,
    })),
  };
}

async function grantTableAccess({ adminId, databaseKey, tableKey, grantedByAdminId }) {
  const normalizedAdminId = Number(adminId);
  if (!Number.isInteger(normalizedAdminId) || normalizedAdminId <= 0) {
    throw createHttpError(400, "请选择要授权的管理员");
  }
  const normalizedDatabaseKey = normalizeDatabaseKey(databaseKey);
  const normalizedTableKey = normalizeTableKey(tableKey);
  const target = await XhuntAdminManager.findByPk(normalizedAdminId);
  if (!target) throw createHttpError(404, "管理员不存在");
  if (target.role === "super") {
    throw createHttpError(400, "超级管理员已拥有全部 DB Admin 权限，无需单独授权");
  }

  const [grant, created] = await XhuntAdminDbTableGrant.findOrCreate({
    where: {
      adminId: normalizedAdminId,
      databaseKey: normalizedDatabaseKey,
      tableKey: normalizedTableKey,
    },
    defaults: { grantedByAdminId },
  });

  if (!created && grant.grantedByAdminId !== grantedByAdminId) {
    await grant.update({ grantedByAdminId });
  }
  return { grant, created };
}

async function revokeTableAccess(grantId) {
  const normalizedGrantId = Number(grantId);
  if (!Number.isInteger(normalizedGrantId) || normalizedGrantId <= 0) {
    throw createHttpError(400, "表查看权限 ID 不合法");
  }
  const grant = await XhuntAdminDbTableGrant.findByPk(normalizedGrantId);
  if (!grant) throw createHttpError(404, "表查看权限不存在");
  const snapshot = grant.toJSON();
  await grant.destroy();
  return snapshot;
}

module.exports = {
  DELEGATED_DB_ADMIN_PERMISSION,
  getAdminGrantedTableAccess,
  grantTableAccess,
  hasAnyAdminTableGrant,
  listTableGrantManagementData,
  normalizeDatabaseKey,
  normalizeTableKey,
  revokeTableAccess,
};
