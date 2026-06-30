const { QueryTypes } = require("sequelize");
const { pgInstance } = require("../../models/postgres-start");
const { tables, SENSITIVE_COLUMN_PATTERN } = require("./config");

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

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

function getTableConfig(key) {
  const config = tables[key];
  if (!config) throw createHttpError(404, "表不在 DB Admin 白名单中");
  return config;
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

async function loadRawColumns(config) {
  const rows = await pgInstance.query(
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
        pg_catalog.col_description(format('%I.%I', c.table_schema, c.table_name)::regclass::oid, c.ordinal_position) AS comment
      FROM information_schema.columns c
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

async function getColumns(config) {
  const rawColumns = await loadRawColumns(config);
  const columns = rawColumns.map((row) => normalizeColumn(row, config));
  if (!columns.some((column) => column.name === config.primaryKey)) {
    throw createHttpError(500, `白名单配置错误：未找到主键 ${config.primaryKey}`);
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
    table: config.table,
    primaryKey: config.primaryKey,
    allowCreate: !!config.allowCreate,
    allowUpdate: !!config.allowUpdate,
    allowDelete: !!config.allowDelete,
    searchableColumns: config.searchableColumns || [],
    columns: columns ? visibleColumns(columns) : undefined,
  };
}

async function listTables() {
  const result = [];
  for (const config of Object.values(tables)) {
    result.push(publicTable(config));
  }
  return result;
}

async function getTableSchema(key) {
  const config = getTableConfig(key);
  const columns = await getColumns(config);
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
  const requestedSortBy = String(query.sortBy || config.primaryKey || "").trim();
  const columnMap = new Map(columns.map((column) => [column.name, column]));
  const sortBy = columnMap.has(requestedSortBy) && !columnMap.get(requestedSortBy).hidden
    ? requestedSortBy
    : config.primaryKey;
  const sortOrder = String(query.sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
  return `ORDER BY ${quoteIdentifier(sortBy)} ${sortOrder}`;
}

async function listRows(key, query = {}) {
  const config = getTableConfig(key);
  const columns = await getColumns(config);
  const publicColumns = visibleColumns(columns);
  const selectColumns = publicColumns.map((column) => quoteIdentifier(column.name)).join(", ");
  const replacements = {};
  const whereSql = buildSearchSql(config, columns, query.q, replacements);
  const orderSql = buildOrderSql(config, columns, query);
  const { page, pageSize, offset } = normalizePageOptions(query);
  replacements.limit = pageSize;
  replacements.offset = offset;

  const [countRow] = await pgInstance.query(
    `SELECT COUNT(*)::int AS count FROM ${tableSql(config)} ${whereSql}`,
    { type: QueryTypes.SELECT, replacements }
  );
  const rows = await pgInstance.query(
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

async function getRowByPrimaryKey(config, columns, id) {
  const publicColumns = visibleColumns(columns);
  const selectColumns = publicColumns.map((column) => quoteIdentifier(column.name)).join(", ");
  const [row] = await pgInstance.query(
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

async function createRow(key, body = {}) {
  const config = getTableConfig(key);
  if (!config.allowCreate) throw createHttpError(403, "该表未开放新增能力");
  const columns = await getColumns(config);
  const values = buildWritePayload(config, columns, body, "create");
  applyManagedTimestamps(values, columns, "create");
  const names = Object.keys(values);
  const insertColumns = names.map(quoteIdentifier).join(", ");
  const valuePlaceholders = names.map((name) => `:${name}`).join(", ");
  const returningColumns = visibleColumns(columns).map((column) => quoteIdentifier(column.name)).join(", ");
  const [row] = await pgInstance.query(
    `INSERT INTO ${tableSql(config)} (${insertColumns}) VALUES (${valuePlaceholders}) RETURNING ${returningColumns}`,
    { type: QueryTypes.SELECT, replacements: values }
  );
  const created = Array.isArray(row) ? row[0] : row;
  return { table: publicTable(config, columns), row: created, changedColumns: names };
}

async function updateRow(key, id, body = {}) {
  const config = getTableConfig(key);
  if (!config.allowUpdate) throw createHttpError(403, "该表未开放更新能力");
  const columns = await getColumns(config);
  const before = await getRowByPrimaryKey(config, columns, id);
  if (!before) throw createHttpError(404, "记录不存在");

  const values = buildWritePayload(config, columns, body, "update");
  applyManagedTimestamps(values, columns, "update");
  const names = Object.keys(values);
  const setSql = names.map((name) => `${quoteIdentifier(name)} = :${name}`).join(", ");
  const returningColumns = visibleColumns(columns).map((column) => quoteIdentifier(column.name)).join(", ");
  const [row] = await pgInstance.query(
    `UPDATE ${tableSql(config)} SET ${setSql} WHERE ${quoteIdentifier(config.primaryKey)} = :__id RETURNING ${returningColumns}`,
    { type: QueryTypes.SELECT, replacements: { ...values, __id: id } }
  );
  const updated = Array.isArray(row) ? row[0] : row;
  return { table: publicTable(config, columns), before, row: updated, changedColumns: names };
}

async function deleteRow(key, id) {
  const config = getTableConfig(key);
  if (!config.allowDelete) throw createHttpError(403, "该表未开放删除能力");
  const columns = await getColumns(config);
  const before = await getRowByPrimaryKey(config, columns, id);
  if (!before) throw createHttpError(404, "记录不存在");
  await pgInstance.query(
    `DELETE FROM ${tableSql(config)} WHERE ${quoteIdentifier(config.primaryKey)} = :id`,
    { type: QueryTypes.DELETE, replacements: { id } }
  );
  return { table: publicTable(config, columns), row: before };
}

module.exports = {
  listTables,
  getTableSchema,
  listRows,
  createRow,
  updateRow,
  deleteRow,
};
