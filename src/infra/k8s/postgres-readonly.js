const { Sequelize, QueryTypes } = require("sequelize");

/**
 * K8s 注入的 PostgreSQL 只读从库连接。
 *
 * 环境变量说明（优先读取 K8S_PG_READ_*，同时兼容旧 PG_READ_* 命名）：
 * - K8S_PG_READ_DATABASE_URL：只读从库完整连接串，优先级最高。
 * - K8S_PG_READ_HOST：只读从库主机地址，未配置连接串时使用。
 * - K8S_PG_READ_PORT：只读从库端口，默认 5432。
 * - K8S_PG_READ_DATABASE：只读从库数据库名。
 * - K8S_PG_READ_USERNAME：只读从库账号。
 * - K8S_PG_READ_PASSWORD：只读从库密码。
 * - K8S_PG_READ_DIALECT：Sequelize 方言，默认 postgres。
 * - K8S_PG_READ_ALLOW_PRIMARY：是否允许连接落到主库；生产默认 false，防止误查主库。
 * - K8S_PG_READ_POOL_MAX：只读连接池最大连接数，默认 3。
 * - K8S_PG_READ_POOL_MIN：只读连接池最小连接数，默认 0。
 * - K8S_PG_READ_STATEMENT_TIMEOUT_MS：单条 SQL 超时时间，默认 1500ms。
 * - K8S_PG_READ_SSL：是否启用 SSL，true 时打开。
 * - K8S_PG_READ_SSL_REJECT_UNAUTHORIZED：SSL 是否校验证书，默认校验，显式 false 时跳过。
 * - K8S_PG_READ_LOGGING：是否打印 Sequelize SQL 日志，默认关闭。
 *
 * 业务隔离连接池：
 * - getPostgresReadOnlyInstance("social-listening") 会创建独立只读池，避免和 KOL / Admin 查询抢连接。
 * - 可用 K8S_PG_READ_SOCIAL_LISTENING_POOL_MAX 等作用域变量覆盖通用配置。
 */

// 只读 Sequelize 实例按业务作用域拆分连接池；不加载业务模型，也不执行 sync。
const pgReadInstances = new Map();

// 只读从库初始化状态同样按业务作用域拆分，避免 scoped pool 复用 default ready 状态。
const pgReadSetupStates = new Map();

// 按顺序读取环境变量，前面的命名优先级更高。
function getEnvValue(names = []) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function normalizeScope(scope) {
  const normalized = String(scope || "default")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || "DEFAULT";
}

function getScopeName(scope) {
  return normalizeScope(scope).toLowerCase().replace(/_/g, "-");
}

function getApplicationName(scope) {
  const scopeName = getScopeName(scope);
  return scopeName === "default" ? "xhunt-pg-readonly" : `xhunt-pg-readonly-${scopeName}`;
}

function createSetupState(scope = "default") {
  return {
    scope: getScopeName(scope),
    configured: false,
    ready: false,
    checkedAt: null,
    server: null,
    error: null,
  };
}

function getSetupState(scope = "default") {
  const scopeKey = normalizeScope(scope);
  if (!pgReadSetupStates.has(scopeKey)) {
    pgReadSetupStates.set(scopeKey, createSetupState(scope));
  }
  return pgReadSetupStates.get(scopeKey);
}

// 统一读取 K8S_PG_READ_*；fallbackNames 只做历史环境变量兼容。
function getK8sPgReadEnv(suffix, fallbackNames = []) {
  return getEnvValue([`K8S_PG_READ_${suffix}`, ...fallbackNames]);
}

function getScopedK8sPgReadEnv(scope, suffix, fallbackNames = []) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === "DEFAULT") {
    return getK8sPgReadEnv(suffix, fallbackNames);
  }
  return getEnvValue([
    `K8S_PG_READ_${normalizedScope}_${suffix}`,
    `PG_READ_${normalizedScope}_${suffix}`,
    `K8S_PG_READ_${suffix}`,
    ...fallbackNames,
    `PG_READ_${suffix}`,
  ]);
}

// 连接串模式：K8s Secret 直接注入完整只读从库 URL。
function getK8sReadUrl(scope = "default") {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === "DEFAULT") {
    return getK8sPgReadEnv("DATABASE_URL", [
      "PG_READ_DATABASE_URL",
      "DATABASE_URL_READ",
    ]);
  }
  return getEnvValue([
    `K8S_PG_READ_${normalizedScope}_DATABASE_URL`,
    `PG_READ_${normalizedScope}_DATABASE_URL`,
    `DATABASE_URL_READ_${normalizedScope}`,
    "K8S_PG_READ_DATABASE_URL",
    "PG_READ_DATABASE_URL",
    "DATABASE_URL_READ",
  ]);
}

// 拆分字段模式：没有完整连接串时，用 host/database/username/password 组装连接。
function getK8sReadObjectConfig(scope = "default") {
  const host = getScopedK8sPgReadEnv(scope, "HOST", ["PG_READ_HOST"]);
  const database = getScopedK8sPgReadEnv(scope, "DATABASE", ["PG_READ_DATABASE", "PG_DATABASE"]);
  const username = getScopedK8sPgReadEnv(scope, "USERNAME", ["PG_READ_USERNAME"]);
  const password = getScopedK8sPgReadEnv(scope, "PASSWORD", ["PG_READ_PASSWORD"]);

  if (!host || !database || !username || !password) {
    return null;
  }

  const port = Number(getScopedK8sPgReadEnv(scope, "PORT", ["PG_READ_PORT"]) || 5432);

  return {
    dialect: getScopedK8sPgReadEnv(scope, "DIALECT", ["PG_READ_DIALECT", "PG_DIALECT"]) || "postgres",
    host,
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 5432,
    database,
    username,
    password,
  };
}

// 只判断配置是否存在，不主动连库；用于 API 启动和接口前置检查。
function isPostgresReadOnlyConfigured(scope = "default") {
  return Boolean(getK8sReadUrl(scope) || getK8sReadObjectConfig(scope));
}

// 连接级保护：强制默认只读、设置 statement_timeout，避免慢 SQL 或误写拖垮从库。
function buildDialectOptions(scope = "default") {
  const statementTimeout = Number(
    getScopedK8sPgReadEnv(scope, "STATEMENT_TIMEOUT_MS", ["PG_READ_STATEMENT_TIMEOUT_MS"]) || 1500
  );
  const safeStatementTimeout = Number.isFinite(statementTimeout) && statementTimeout > 0
    ? statementTimeout
    : 1500;

  const dialectOptions = {
    // 生产 K8s 中通常通过 Secret 注入连接串；这里不直接调用 Kubernetes API，
    // 只承载“由 K8s 注入的只读 PostgreSQL 连接”。
    options: [
      "-c default_transaction_read_only=on",
      `-c statement_timeout=${safeStatementTimeout}`,
      "-c idle_in_transaction_session_timeout=3000",
      `-c application_name=${getApplicationName(scope)}`,
    ].join(" "),
  };

  if (getScopedK8sPgReadEnv(scope, "SSL", ["PG_READ_SSL", "PG_SSL"]) === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: getScopedK8sPgReadEnv(scope, "SSL_REJECT_UNAUTHORIZED", [
        "PG_READ_SSL_REJECT_UNAUTHORIZED",
        "PG_SSL_REJECT_UNAUTHORIZED",
      ]) !== "false",
    };
  }

  return dialectOptions;
}

function createPostgresReadOnlyInstance(scope = "default") {
  // 只读从库连接池保持保守配置，避免新增能力对从库造成过大连接压力。
  const commonOptions = {
    dialect: "postgres",
    logging: getScopedK8sPgReadEnv(scope, "LOGGING", ["PG_READ_LOGGING"]) === "true",
    timezone: "+00:00",
    pool: {
      max: Number(getScopedK8sPgReadEnv(scope, "POOL_MAX", ["PG_READ_POOL_MAX"]) || 3),
      min: Number(getScopedK8sPgReadEnv(scope, "POOL_MIN", ["PG_READ_POOL_MIN"]) || 0),
      idle: 10000,
      acquire: 10000,
    },
    dialectOptions: buildDialectOptions(scope),
  };

  // 优先使用完整连接串，便于 K8s Secret 统一管理。
  const readUrl = getK8sReadUrl(scope);
  if (readUrl) {
    return new Sequelize(readUrl, commonOptions);
  }

  // 没有连接串时，退到拆分字段模式。
  const objectConfig = getK8sReadObjectConfig(scope);
  if (!objectConfig) {
    const error = new Error(
      "K8s PG read-only env incomplete: require K8S_PG_READ_DATABASE_URL or K8S_PG_READ_HOST/K8S_PG_READ_DATABASE/K8S_PG_READ_USERNAME/K8S_PG_READ_PASSWORD"
    );
    error.code = "PG_READ_NOT_CONFIGURED";
    throw error;
  }

  return new Sequelize({
    ...objectConfig,
    logging: commonOptions.logging,
    timezone: commonOptions.timezone,
    pool: commonOptions.pool,
    dialectOptions: commonOptions.dialectOptions,
  });
}

function getPostgresReadOnlyInstance(scope = "default") {
  // 未配置时直接抛业务可识别错误，接口层会转成 503。
  if (!isPostgresReadOnlyConfigured(scope)) {
    const error = new Error("PG read-only connection is not configured");
    error.code = "PG_READ_NOT_CONFIGURED";
    throw error;
  }

  // 懒创建实例：模块 require 时不连库，setup 或首次查询时再创建。
  const scopeKey = normalizeScope(scope);
  if (!pgReadInstances.has(scopeKey)) {
    pgReadInstances.set(scopeKey, createPostgresReadOnlyInstance(scope));
  }

  return pgReadInstances.get(scopeKey);
}

async function setupK8sPostgresReadOnlyConnection(scope = "default") {
  const scopeKey = normalizeScope(scope);
  const scopeName = getScopeName(scope);
  const setupState = getSetupState(scope);

  // 每次 setup 都刷新状态，便于接口层准确判断只读从库是否 ready。
  setupState.scope = scopeName;
  setupState.configured = isPostgresReadOnlyConfigured(scope);
  setupState.checkedAt = new Date().toISOString();
  setupState.error = null;

  if (!setupState.configured) {
    setupState.ready = false;
    setupState.server = null;
    console.warn(`[PG ReadOnly] skip setup scope=${scopeName}: read-only env is not configured`);
    return setupState;
  }

  try {
    const instance = getPostgresReadOnlyInstance(scope);
    await instance.authenticate();

    // 启动时做安全校验：
    // 1. pg_is_in_recovery() 确认是否从库；
    // 2. transaction_read_only 确认连接级只读参数是否生效；
    // 3. server addr/port 打到日志，方便线上确认实际命中节点。
    const [row] = await instance.query(
      `
        SELECT
          pg_is_in_recovery() AS "inRecovery",
          current_database() AS "databaseName",
          inet_server_addr()::text AS "serverAddr",
          inet_server_port() AS "serverPort",
          current_setting('transaction_read_only') AS "transactionReadOnly"
      `,
      { type: QueryTypes.SELECT }
    );

    const allowPrimary = getScopedK8sPgReadEnv(scope, "ALLOW_PRIMARY", ["PG_READ_ALLOW_PRIMARY"]) === "true";
    // 默认不允许连接到主库；除非显式 K8S_PG_READ_ALLOW_PRIMARY=true。
    if (!allowPrimary && !row.inRecovery) {
      const error = new Error(
        `[PG ReadOnly] expected replica for scope=${scopeName}, but connected to primary ${row.serverAddr}:${row.serverPort}`
      );
      error.code = "PG_READ_CONNECTED_TO_PRIMARY";
      throw error;
    }

    setupState.ready = true;
    setupState.server = {
      databaseName: row.databaseName,
      serverAddr: row.serverAddr,
      serverPort: row.serverPort,
      inRecovery: row.inRecovery,
      transactionReadOnly: row.transactionReadOnly,
    };

    console.log(
      `[PG ReadOnly] connected scope=${scopeName} database=${row.databaseName} server=${row.serverAddr}:${row.serverPort} recovery=${row.inRecovery} readonly=${row.transactionReadOnly}`
    );

    return setupState;
  } catch (error) {
    setupState.ready = false;
    setupState.error = error.message;
    setupState.server = null;

    // 初始化失败时关闭半初始化连接，避免后续业务复用异常连接池。
    const pgReadInstance = pgReadInstances.get(scopeKey);
    if (pgReadInstance) {
      try {
        await pgReadInstance.close();
      } catch (closeError) {
        console.warn("[PG ReadOnly] close failed after setup error:", closeError.message);
      } finally {
        pgReadInstances.delete(scopeKey);
      }
    }
    throw error;
  }
}

function getPostgresReadOnlyStatus(scope = "default") {
  const setupState = getSetupState(scope);
  return {
    ...setupState,
    configured: isPostgresReadOnlyConfigured(scope),
    server: setupState.server ? { ...setupState.server } : null,
  };
}

module.exports = {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
  setupK8sPostgresReadOnlyConnection,
};
