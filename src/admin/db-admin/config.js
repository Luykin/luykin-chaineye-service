/**
 * 管理后台轻量 DB CRUD 白名单配置。
 *
 * 安全原则：
 * 1. 这里只允许配置过的表进入管理后台，不提供任意 SQL 能力。
 * 2. 默认按字段名隐藏 password/token/secret/privateKey 等敏感字段。
 * 3. 写入能力按表单独打开；第一版路由层仍限制 super 管理员访问。
 * 4. 新增表时必须明确 primaryKey、searchableColumns、readonly/hidden 字段。
 */
const SENSITIVE_COLUMN_PATTERN = /(password|passwordHash|token|secret|privateKey|credential|publicKey|signature|nonce|accessToken|refreshToken|authorizationCode|session)/i;

const commonReadonlyColumns = ["id", "createdAt", "updatedAt", "deletedAt"];

const tables = {
  vipTestUsers: {
    key: "vipTestUsers",
    label: "VIP / 内测名单",
    description: "维护 xhunt_vip_test_users，适合少量名单增删改。",
    schema: "public",
    table: "xhunt_vip_test_users",
    primaryKey: "id",
    allowCreate: true,
    allowUpdate: true,
    allowDelete: true,
    searchableColumns: ["username", "twitterId", "listType"],
    readonlyColumns: commonReadonlyColumns,
    hiddenColumns: [],
    enumOptions: {
      listType: ["vip", "internal_test"],
    },
  },

  userTags: {
    key: "userTags",
    label: "用户标签",
    description: "维护 xhunt_user_tags，JSON 标签字段支持可视化编辑。",
    schema: "public",
    table: "xhunt_user_tags",
    primaryKey: "id",
    allowCreate: true,
    allowUpdate: true,
    allowDelete: true,
    searchableColumns: ["username", "twitterId"],
    readonlyColumns: commonReadonlyColumns,
    hiddenColumns: [],
  },

  websiteCampaigns: {
    key: "websiteCampaigns",
    label: "网站活动扩展",
    description: "维护网站活动的展示字段。为避免误建活动，第一版仅允许更新。",
    schema: "public",
    table: "XHuntWebsiteCampaigns",
    primaryKey: "id",
    allowCreate: false,
    allowUpdate: true,
    allowDelete: false,
    searchableColumns: ["nacosCampaignId", "campaignKey", "slug", "displayNameZh", "displayNameEn", "webStatus"],
    readonlyColumns: ["id", "nacosCampaignId", "campaignKey", "createdAt", "updatedAt", "deletedAt"],
    hiddenColumns: ["nacosPayload"],
  },

  authCenterClients: {
    key: "authCenterClients",
    label: "认证中心客户端",
    description: "认证中心 client 配置。密钥哈希默认隐藏，第一版不允许新增和删除。",
    schema: "public",
    table: "AuthCenterXhuntClients",
    primaryKey: "id",
    allowCreate: false,
    allowUpdate: true,
    allowDelete: false,
    searchableColumns: ["clientKey", "clientName", "clientType"],
    readonlyColumns: ["id", "clientKey", "createdAt", "updatedAt"],
    hiddenColumns: ["clientSecretHash"],
    enumOptions: {
      clientType: ["public", "confidential"],
    },
  },

  nacosSnapshots: {
    key: "nacosSnapshots",
    label: "Nacos 配置快照",
    description: "只读查看配置变更快照，便于排查配置历史。",
    schema: "public",
    table: "xhunt_nacos_config_snapshots",
    primaryKey: "id",
    allowCreate: false,
    allowUpdate: false,
    allowDelete: false,
    searchableColumns: ["dataId", "group", "tenant", "action", "operatorEmail", "reason"],
    readonlyColumns: ["id", "createdAt", "updatedAt"],
    hiddenColumns: [],
  },
};

module.exports = {
  tables,
  SENSITIVE_COLUMN_PATTERN,
};
