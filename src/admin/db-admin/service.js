const crypto = require("crypto");
const { Sequelize, QueryTypes } = require("sequelize");
const { pgInstance } = require("../../models/postgres-start");
const { getRedisClient } = require("../../lib/redisClient");
const { DEFAULT_READONLY_COLUMNS, SENSITIVE_COLUMN_PATTERN, tableMetadata, tableOverrides } = require("./config");

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_DB_KEY = process.env.PG_DATABASE || "luykindatabase";

const DATABASE_DEFINITIONS = [
  {
    key: "luykindatabase",
    name: process.env.PG_DATABASE || "luykindatabase",
    label: "luykindatabase（主业务库）",
    description: "XHunt / EchoHunt / 认证中心 / 管理后台主业务数据库",
    configurableCredentials: false,
  },
  {
    key: "luykindatabase2",
    name: process.env.PG2_DATABASE || "luykindatabase2",
    label: "luykindatabase2（数据 / E2E 库）",
    description: "E2E 互动任务（e2e / e2e_list / e2e_log / e2e_tweet）及扩展分析数据库",
    configurableCredentials: true,
  },
];

const dbInstances = new Map();
const dbCredentialsMemory = new Map();

function getCredentialRedisKey(dbKey) {
  return `admin:db-admin:credentials:${dbKey}`;
}

function getEncryptionKey() {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "xhunt-db-admin-default-secret";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encryptCredentials(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptCredentials(rawText) {
  const parsed = JSON.parse(rawText);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(parsed.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

async function loadSavedCredentials(dbKey) {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(getCredentialRedisKey(dbKey));
    if (raw) {
      const creds = decryptCredentials(raw);
      dbCredentialsMemory.set(dbKey, creds);
      return creds;
    }
  } catch (_) {
    // Fall back to memory / env if Redis read fails
  }
  return dbCredentialsMemory.get(dbKey) || null;
}

function createSecondarySequelize(databaseName, customCreds = null) {
  const dialectOptions = {};
  if (process.env.PG_SSL === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }
  const username = customCreds?.username || process.env.PG2_USERNAME || "luykin2";
  const password = customCreds?.password ?? process.env.PG2_PASSWORD ?? process.env.PG_PASSWORD;
  return new Sequelize({
    dialect: process.env.PG_DIALECT || "postgres",
    host: process.env.PG2_HOST || process.env.PG_HOST,
    port: parseInt(process.env.PG2_PORT || process.env.PG_PORT || "5432", 10),
    database: databaseName,
    username,
    password,
    logging: process.env.PG_LOGGING === "true",
    timezone: "+00:00",
    pool: { max: 5, min: 0, idle: 10000, acquire: 20000 },
    dialectOptions,
  });
}

function resolveDbKey(dbKey) {
  const normalized = String(dbKey || "").trim();
  if (!normalized) return "luykindatabase";
  const matched = DATABASE_DEFINITIONS.find((item) => item.key === normalized || item.name === normalized);
  if (!matched) {
    throw createHttpError(400, `不支持的数据库：${normalized}`);
  }
  return matched.key;
}

async function getDbInstance(dbKey) {
  const resolvedKey = resolveDbKey(dbKey);
  if (resolvedKey === "luykindatabase") {
    return pgInstance;
  }
  const savedCreds = await loadSavedCredentials(resolvedKey);
  const sig = JSON.stringify({
    u: savedCreds?.username || process.env.PG2_USERNAME || "luykin2",
    p: savedCreds?.password ?? process.env.PG2_PASSWORD ?? process.env.PG_PASSWORD ?? "",
  });
  const cached = dbInstances.get(resolvedKey);
  if (!cached || cached.sig !== sig) {
    if (cached?.instance) {
      cached.instance.close().catch(() => {});
    }
    const def = DATABASE_DEFINITIONS.find((item) => item.key === resolvedKey);
    const instance = createSecondarySequelize(def ? def.name : resolvedKey, savedCreds);
    dbInstances.set(resolvedKey, { sig, instance });
  }
  return dbInstances.get(resolvedKey).instance;
}

async function listDatabases() {
  const savedDb2 = await loadSavedCredentials("luykindatabase2");
  return {
    defaultDatabase: "luykindatabase",
    databases: DATABASE_DEFINITIONS.map((item) => ({
      ...item,
      username:
        item.key === "luykindatabase"
          ? process.env.PG_USERNAME || "luykin"
          : savedDb2?.username || process.env.PG2_USERNAME || "luykin2",
      hasPasswordConfigured:
        item.key === "luykindatabase"
          ? true
          : Boolean(savedDb2?.password || process.env.PG2_PASSWORD),
    })),
  };
}

async function saveDatabaseCredentials(dbKey, body = {}) {
  const resolvedKey = resolveDbKey(dbKey);
  if (resolvedKey === "luykindatabase") {
    throw createHttpError(400, "主业务库使用系统默认环境变量，不支持在此修改");
  }
  const username = String(body.username || "luykin2").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    throw createHttpError(400, "请输入数据库用户名和密码");
  }

  const def = DATABASE_DEFINITIONS.find((item) => item.key === resolvedKey);
  const testInstance = createSecondarySequelize(def ? def.name : resolvedKey, { username, password });
  try {
    await testInstance.authenticate();
  } catch (error) {
    await testInstance.close().catch(() => {});
    throw createHttpError(400, `数据库连接测试失败：${error.message || "账号或密码错误"}`);
  }
  await testInstance.close().catch(() => {});

  const payload = { username, password, updatedAt: new Date().toISOString() };
  dbCredentialsMemory.set(resolvedKey, payload);
  try {
    const redis = await getRedisClient();
    await redis.set(getCredentialRedisKey(resolvedKey), encryptCredentials(payload));
  } catch (error) {
    console.warn("[db-admin] failed to persist credentials to redis:", error?.message || error);
  }

  const cached = dbInstances.get(resolvedKey);
  if (cached?.instance) {
    await cached.instance.close().catch(() => {});
    dbInstances.delete(resolvedKey);
  }

  return {
    database: resolvedKey,
    username,
    connected: true,
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function tableSql(config) {
  return `${quoteIdentifier(config.schema)}.${quoteIdentifier(config.table)}`;
}

function parseTableKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return { schema: "public", tableName: "" };
  const dotIndex = raw.indexOf(".");
  if (dotIndex > 0 && dotIndex < raw.length - 1) {
    return {
      schema: raw.slice(0, dotIndex),
      tableName: raw.slice(dotIndex + 1),
    };
  }
  return { schema: "public", tableName: raw };
}

function getDefaultConfig(tableName, primaryKey = null, schema = "public") {
  const normalizedSchema = schema || "public";
  const fullKey = normalizedSchema === "public" ? tableName : `${normalizedSchema}.${tableName}`;
  const override = tableOverrides[fullKey] || tableOverrides[tableName] || {};
  const metadata = tableMetadata[fullKey] || tableMetadata[tableName] || {
    label: normalizedSchema === "public" ? "未归类系统表" : `${normalizedSchema}.${tableName}`,
    description: `尚未登记业务说明的系统数据表（${fullKey}）。`,
  };
  const hasSinglePrimaryKey = !!primaryKey;
  return {
    key: fullKey,
    label: metadata.label,
    description: metadata.description,
    schema: normalizedSchema,
    table: tableName,
    primaryKey,
    hasSinglePrimaryKey,
    allowCreate: override.allowCreate ?? true,
    allowUpdate: override.allowUpdate ?? hasSinglePrimaryKey,
    allowDelete: override.allowDelete ?? hasSinglePrimaryKey,
    searchableColumns: override.searchableColumns || [],
    readonlyColumns: override.readonlyColumns || DEFAULT_READONLY_COLUMNS,
    hiddenColumns: override.hiddenColumns || [],
    enumOptions: override.enumOptions || {},
  };
}

async function loadPrimaryKeys(tableName, dbKey, schema = "public") {
  const db = await getDbInstance(dbKey);
  const rows = await db.query(
    `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = :schema
        AND tc.table_name = :table
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position ASC
    `,
    { type: QueryTypes.SELECT, replacements: { schema, table: tableName } }
  );
  return rows.map((row) => row.column_name).filter(Boolean);
}

async function getTableConfig(key, dbKey) {
  const { schema, tableName } = parseTableKey(key);
  if (!tableName) throw createHttpError(404, "表不存在");
  const db = await getDbInstance(dbKey);

  const [tableRow] = await db.query(
    `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = :schema
        AND table_type = 'BASE TABLE'
        AND table_name = :table
      LIMIT 1
    `,
    { type: QueryTypes.SELECT, replacements: { schema, table: tableName } }
  );
  if (!tableRow) throw createHttpError(404, `表不存在：${schema}.${tableName}`);

  const primaryKeys = await loadPrimaryKeys(tableName, dbKey, schema);
  return getDefaultConfig(tableName, primaryKeys.length === 1 ? primaryKeys[0] : null, schema);
}

function inferSearchableColumns(columns) {
  return columns
    .filter((column) => !column.hidden)
    .filter((column) => {
      const type = `${column.dataType || ""} ${column.udtName || ""}`.toLowerCase();
      return /char|text|uuid|integer|bigint|smallint|numeric/.test(type);
    })
    .slice(0, 8)
    .map((column) => column.name);
}

function isSensitiveColumn(columnName, config) {
  return SENSITIVE_COLUMN_PATTERN.test(columnName) || (config.hiddenColumns || []).includes(columnName);
}

function isReadonlyColumn(columnName, config) {
  return columnName === config.primaryKey || (config.readonlyColumns || []).includes(columnName);
}

function normalizeColumn(row, config) {
  const hidden = isSensitiveColumn(row.column_name, config);
  const readonly = hidden || isReadonlyColumn(row.column_name, config);
  const dataType = row.data_type || row.udt_name || "";
  return {
    name: row.column_name,
    dataType,
    udtName: row.udt_name,
    nullable: row.is_nullable === "YES",
    defaultValue: row.column_default || null,
    maxLength: row.character_maximum_length || null,
    numericPrecision: row.numeric_precision || null,
    numericScale: row.numeric_scale || null,
    ordinalPosition: Number(row.ordinal_position || 0),
    comment: row.comment || null,
    hidden,
    readonly,
    primaryKey: row.column_name === config.primaryKey,
    enumOptions: config.enumOptions?.[row.column_name] || null,
  };
}

async function loadRawColumns(config, dbKey) {
  const db = await getDbInstance(dbKey);
  const rows = await db.query(
    `
      SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.ordinal_position,
        pg_catalog.col_description(cls.oid, c.ordinal_position) AS comment
      FROM information_schema.columns c
      LEFT JOIN pg_catalog.pg_namespace n
        ON n.nspname = c.table_schema
      LEFT JOIN pg_catalog.pg_class cls
        ON cls.relnamespace = n.oid
       AND cls.relname = c.table_name
      WHERE c.table_schema = :schema AND c.table_name = :table
      ORDER BY c.ordinal_position ASC
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { schema: config.schema, table: config.table },
    }
  );
  if (!rows.length) throw createHttpError(404, `数据库中未找到表：${config.schema}.${config.table}`);
  return rows;
}

async function getColumns(config, dbKey) {
  const rawColumns = await loadRawColumns(config, dbKey);
  const columns = rawColumns.map((row) => normalizeColumn(row, config));
  if (!config.primaryKey) {
    const firstVisibleColumn = columns.find((column) => !column.hidden) || columns[0];
    if (firstVisibleColumn) config.primaryKey = firstVisibleColumn.name;
  }
  if (!config.searchableColumns?.length) {
    config.searchableColumns = inferSearchableColumns(columns);
  }
  return columns;
}

function visibleColumns(columns) {
  return columns.filter((column) => !column.hidden);
}

function publicTable(config, columns) {
  return {
    key: config.key,
    label: config.label,
    description: config.description || "",
    table: config.schema === "public" ? config.table : `${config.schema}.${config.table}`,
    primaryKey: config.primaryKey,
    hasSinglePrimaryKey: !!config.hasSinglePrimaryKey,
    allowCreate: !!config.allowCreate,
    allowUpdate: !!config.allowUpdate,
    allowDelete: !!config.allowDelete,
    searchableColumns: config.searchableColumns || [],
    columns: columns ? visibleColumns(columns) : undefined,
  };
}

async function listTables(dbKey) {
  const db = await getDbInstance(dbKey);
  const rows = await db.query(
    `
      SELECT t.table_schema, t.table_name, pk.primary_key
      FROM information_schema.tables t
      LEFT JOIN (
        SELECT
          kcu.table_schema,
          kcu.table_name,
          CASE WHEN COUNT(*) = 1 THEN MIN(kcu.column_name) ELSE NULL END AS primary_key
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
        GROUP BY kcu.table_schema, kcu.table_name
      ) pk ON pk.table_schema = t.table_schema AND pk.table_name = t.table_name
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_schema NOT LIKE 'pg_%'
        AND t.table_type = 'BASE TABLE'
      ORDER BY CASE WHEN t.table_schema = 'public' THEN 0 ELSE 1 END ASC, t.table_schema ASC, t.table_name ASC
    `,
    { type: QueryTypes.SELECT }
  );
  return rows.map((row) => publicTable(getDefaultConfig(row.table_name, row.primary_key || null, row.table_schema || "public")));
}

async function getTableSchema(key, dbKey) {
  const config = await getTableConfig(key, dbKey);
  const columns = await getColumns(config, dbKey);
  return publicTable(config, columns);
}

function normalizePageOptions(query = {}) {
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function buildSearchSql(config, columns, queryText, replacements) {
  const q = String(queryText || "").trim();
  if (!q) return "";
  const columnMap = new Map(columns.map((column) => [column.name, column]));
  const searchable = (config.searchableColumns || [])
    .filter((columnName) => columnMap.has(columnName))
    .filter((columnName) => !columnMap.get(columnName).hidden);
  if (!searchable.length) return "";
  replacements.search = `%${q}%`;
  return `WHERE (${searchable.map((columnName) => `${quoteIdentifier(columnName)}::text ILIKE :search`).join(" OR ")})`;
}

function buildOrderSql(config, columns, query = {}) {
  const fallbackColumn = config.primaryKey || columns.find((column) => !column.hidden)?.name || columns[0]?.name;
  const requestedSortBy = String(query.sortBy || fallbackColumn || "").trim();
  const columnMap = new Map(columns.map((column) => [column.name, column]));
  const sortBy = columnMap.has(requestedSortBy) && !columnMap.get(requestedSortBy).hidden
    ? requestedSortBy
    : fallbackColumn;
  if (!sortBy) return "";
  const sortOrder = String(query.sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
  return `ORDER BY ${quoteIdentifier(sortBy)} ${sortOrder}`;
}

async function listRows(key, query = {}, dbKey) {
  const resolvedDbKey = resolveDbKey(dbKey || query.db);
  const db = await getDbInstance(resolvedDbKey);
  const config = await getTableConfig(key, resolvedDbKey);
  const columns = await getColumns(config, resolvedDbKey);
  const publicColumns = visibleColumns(columns);
  const selectColumns = publicColumns.map((column) => quoteIdentifier(column.name)).join(", ");
  const replacements = {};
  const whereSql = buildSearchSql(config, columns, query.q, replacements);
  const orderSql = buildOrderSql(config, columns, query);
  const { page, pageSize, offset } = normalizePageOptions(query);
  replacements.limit = pageSize;
  replacements.offset = offset;

  const [countRow] = await db.query(
    `SELECT COUNT(*)::int AS count FROM ${tableSql(config)} ${whereSql}`,
    { type: QueryTypes.SELECT, replacements }
  );
  const rows = await db.query(
    `SELECT ${selectColumns} FROM ${tableSql(config)} ${whereSql} ${orderSql} LIMIT :limit OFFSET :offset`,
    { type: QueryTypes.SELECT, replacements }
  );

  return {
    table: publicTable(config, columns),
    rows,
    pagination: {
      page,
      pageSize,
      total: Number(countRow?.count || 0),
    },
  };
}

function parseJsonValue(value, columnName) {
  if (value === null || value === undefined || value === "") return value === "" ? null : value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_) {
      throw createHttpError(400, `${columnName} 必须是合法 JSON`);
    }
  }
  return value;
}

function normalizeBooleanValue(value, columnName) {
  if (value === null || value === undefined || value === "") return value === "" ? null : value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "off"].includes(lowered)) return false;
  }
  throw createHttpError(400, `${columnName} 必须是布尔值`);
}

function normalizeNumberValue(value, column, integerOnly) {
  if (value === null || value === undefined || value === "") return value === "" ? null : value;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw createHttpError(400, `${column.name} 必须是数字`);
  if (integerOnly && !/^-?\d+$/.test(text)) throw createHttpError(400, `${column.name} 必须是整数`);
  if (column.udtName === "int8" || column.dataType === "numeric") return text;
  const num = Number(text);
  if (!Number.isFinite(num)) throw createHttpError(400, `${column.name} 数字超出范围`);
  return integerOnly ? Math.trunc(num) : num;
}

function normalizeDateValue(value, columnName) {
  if (value === null || value === undefined || value === "") return value === "" ? null : value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw createHttpError(400, `${columnName} 必须是合法日期`);
  return value;
}

function normalizeValue(value, column) {
  const dataType = String(column.dataType || "").toLowerCase();
  const udtName = String(column.udtName || "").toLowerCase();

  if (["json", "jsonb"].includes(dataType) || ["json", "jsonb"].includes(udtName)) {
    return parseJsonValue(value, column.name);
  }
  if (dataType === "boolean" || udtName === "bool") {
    return normalizeBooleanValue(value, column.name);
  }
  if (["integer", "bigint", "smallint"].includes(dataType) || ["int2", "int4", "int8"].includes(udtName)) {
    return normalizeNumberValue(value, column, true);
  }
  if (["numeric", "double precision", "real"].includes(dataType) || ["numeric", "float4", "float8"].includes(udtName)) {
    return normalizeNumberValue(value, column, false);
  }
  if (dataType.includes("timestamp") || dataType === "date") {
    return normalizeDateValue(value, column.name);
  }
  if (Array.isArray(column.enumOptions) && value !== null && value !== undefined && value !== "" && !column.enumOptions.includes(value)) {
    throw createHttpError(400, `${column.name} 不在允许选项内`);
  }
  return value;
}


function applyManagedTimestamps(values, columns, mode) {
  const columnNames = new Set(columns.map((column) => column.name));
  const now = new Date();
  if (mode === "create" && columnNames.has("createdAt") && values.createdAt === undefined) {
    values.createdAt = now;
  }
  if ((mode === "create" || mode === "update") && columnNames.has("updatedAt") && values.updatedAt === undefined) {
    values.updatedAt = now;
  }
}

async function getRowByPrimaryKey(config, columns, id, dbKey) {
  const db = await getDbInstance(dbKey);
  const publicColumns = visibleColumns(columns);
  const selectColumns = publicColumns.map((column) => quoteIdentifier(column.name)).join(", ");
  const [row] = await db.query(
    `SELECT ${selectColumns} FROM ${tableSql(config)} WHERE ${quoteIdentifier(config.primaryKey)} = :id LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { id } }
  );
  return row || null;
}

function buildWritePayload(config, columns, body = {}, mode) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createHttpError(400, "请求体必须是对象");
  }

  const writableColumns = columns.filter((column) => !column.hidden && !isReadonlyColumn(column.name, config));
  const writableMap = new Map(writableColumns.map((column) => [column.name, column]));
  const values = {};

  for (const [columnName, rawValue] of Object.entries(body)) {
    if (!writableMap.has(columnName)) {
      if (columns.some((column) => column.name === columnName)) {
        throw createHttpError(400, `${columnName} 是只读或隐藏字段，不允许写入`);
      }
      continue;
    }
    values[columnName] = normalizeValue(rawValue, writableMap.get(columnName));
  }

  if (!Object.keys(values).length) {
    throw createHttpError(400, mode === "create" ? "没有可新增的字段" : "没有可更新的字段");
  }

  return values;
}

async function createRow(key, body = {}, dbKey) {
  const resolvedDbKey = resolveDbKey(dbKey);
  const db = await getDbInstance(resolvedDbKey);
  const config = await getTableConfig(key, resolvedDbKey);
  if (!config.allowCreate) throw createHttpError(403, "该表未开放新增能力");
  const columns = await getColumns(config, resolvedDbKey);
  const values = buildWritePayload(config, columns, body, "create");
  applyManagedTimestamps(values, columns, "create");
  const names = Object.keys(values);
  const insertColumns = names.map(quoteIdentifier).join(", ");
  const valuePlaceholders = names.map((name) => `:${name}`).join(", ");
  const returningColumns = visibleColumns(columns).map((column) => quoteIdentifier(column.name)).join(", ");
  const [row] = await db.query(
    `INSERT INTO ${tableSql(config)} (${insertColumns}) VALUES (${valuePlaceholders}) RETURNING ${returningColumns}`,
    { type: QueryTypes.SELECT, replacements: values }
  );
  const created = Array.isArray(row) ? row[0] : row;
  return { table: publicTable(config, columns), row: created, changedColumns: names };
}

async function updateRow(key, id, body = {}, dbKey) {
  const resolvedDbKey = resolveDbKey(dbKey);
  const db = await getDbInstance(resolvedDbKey);
  const config = await getTableConfig(key, resolvedDbKey);
  if (!config.hasSinglePrimaryKey) throw createHttpError(403, "该表没有单字段主键，暂不支持更新");
  if (!config.allowUpdate) throw createHttpError(403, "该表未开放更新能力");
  const columns = await getColumns(config, resolvedDbKey);
  const before = await getRowByPrimaryKey(config, columns, id, resolvedDbKey);
  if (!before) throw createHttpError(404, "记录不存在");

  const values = buildWritePayload(config, columns, body, "update");
  applyManagedTimestamps(values, columns, "update");
  const names = Object.keys(values);
  const setSql = names.map((name) => `${quoteIdentifier(name)} = :${name}`).join(", ");
  const returningColumns = visibleColumns(columns).map((column) => quoteIdentifier(column.name)).join(", ");
  const [row] = await db.query(
    `UPDATE ${tableSql(config)} SET ${setSql} WHERE ${quoteIdentifier(config.primaryKey)} = :__id RETURNING ${returningColumns}`,
    { type: QueryTypes.SELECT, replacements: { ...values, __id: id } }
  );
  const updated = Array.isArray(row) ? row[0] : row;
  return { table: publicTable(config, columns), before, row: updated, changedColumns: names };
}

async function deleteRow(key, id, dbKey) {
  const resolvedDbKey = resolveDbKey(dbKey);
  const db = await getDbInstance(resolvedDbKey);
  const config = await getTableConfig(key, resolvedDbKey);
  if (!config.hasSinglePrimaryKey) throw createHttpError(403, "该表没有单字段主键，暂不支持删除");
  if (!config.allowDelete) throw createHttpError(403, "该表未开放删除能力");
  const columns = await getColumns(config, resolvedDbKey);
  const before = await getRowByPrimaryKey(config, columns, id, resolvedDbKey);
  if (!before) throw createHttpError(404, "记录不存在");
  await db.query(
    `DELETE FROM ${tableSql(config)} WHERE ${quoteIdentifier(config.primaryKey)} = :id`,
    { type: QueryTypes.DELETE, replacements: { id } }
  );
  return { table: publicTable(config, columns), row: before };
}

module.exports = {
  DEFAULT_DB_KEY,
  listDatabases,
  saveDatabaseCredentials,
  resolveDbKey,
  listTables,
  getTableSchema,
  listRows,
  createRow,
  updateRow,
  deleteRow,
};
