/**
 * 管理后台轻量 DB CRUD 配置。
 *
 * 当前按数据库 public schema 动态枚举所有基础表；这里仅保留全局安全规则和少量表级覆盖。
 * 注意：不提供任意 SQL，所有字段名/表名仍来自数据库元数据或这里的显式覆盖。
 */
const SENSITIVE_COLUMN_PATTERN = /(password|passwordHash|token|secret|privateKey|credential|publicKey|signature|nonce|accessToken|refreshToken|authorizationCode|session)/i;

const DEFAULT_READONLY_COLUMNS = ["id", "createdAt", "updatedAt", "deletedAt"];

// 如需对某张表单独禁用新增/删除、隐藏字段、枚举字段，在这里按真实表名覆盖。
const tableOverrides = {
  AuthCenterXhuntClients: {
    hiddenColumns: ["clientSecretHash"],
    enumOptions: {
      clientType: ["public", "confidential"],
    },
  },
  xhunt_vip_test_users: {
    enumOptions: {
      listType: ["vip", "internal_test"],
    },
  },
};

module.exports = {
  DEFAULT_READONLY_COLUMNS,
  SENSITIVE_COLUMN_PATTERN,
  tableOverrides,
};
