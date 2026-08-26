const { Sequelize, QueryTypes } = require("sequelize");

/**
 * K8s PostgreSQL 可写主库连接。
 *
 * 注意：
 * - 这个连接只用于需要写入 K8s meta 库的少量同步场景。
 * - 不加载业务模型，不执行 sync。
 * - 不复用 postgres-readonly.js，避免破坏只读查询的安全边界。
 */

let pgWriteInstance = null;

let setupState = {
  configured: false,
  ready: false,
  checkedAt: null,
  server: null,
  error: null,
};

function getEnvValue(names = []) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function getK8sPgWriteEnv(suffix, fallbackNames = []) {
  return getEnvValue([`K8S_PG_WRITE_${suffix}`, ...fallbackNames]);
}

function getK8sWriteUrl() {
  return getK8sPgWriteEnv("DATABASE_URL", [
    "PG_WRITE_DATABASE_URL",
    "DATABASE_URL_WRITE",
  ]);
}

function getK8sWriteObjectConfig() {
  const host = getK8sPgWriteEnv("HOST", ["PG_WRITE_HOST"]);
  const database = getK8sPgWriteEnv("DATABASE", ["PG_WRITE_DATABASE"]);
  const username = getK8sPgWriteEnv("USERNAME", ["PG_WRITE_USERNAME"]);
  const password = getK8sPgWriteEnv("PASSWORD", ["PG_WRITE_PASSWORD"]);

  if (!host || !database || !username || !password) {
    return null;
  }

  const port = Number(getK8sPgWriteEnv("PORT", ["PG_WRITE_PORT"]) || 5432);

  return {
    dialect: getK8sPgWriteEnv("DIALECT", ["PG_WRITE_DIALECT"]) || "postgres",
    host,
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 5432,
    database,
    username,
    password,
  };
}

function isPostgresWriteConfigured() {
  return Boolean(getK8sWriteUrl() || getK8sWriteObjectConfig());
}

function buildDialectOptions() {
  const statementTimeout = Number(
    getK8sPgWriteEnv("STATEMENT_TIMEOUT_MS", ["PG_WRITE_STATEMENT_TIMEOUT_MS"]) || 3000
  );
  const safeStatementTimeout = Number.isFinite(statementTimeout) && statementTimeout > 0
    ? statementTimeout
    : 3000;

  const dialectOptions = {
    options: [
      `-c statement_timeout=${safeStatementTimeout}`,
      "-c idle_in_transaction_session_timeout=5000",
      "-c application_name=xhunt-pg-write",
    ].join(" "),
  };

  if (getK8sPgWriteEnv("SSL", ["PG_WRITE_SSL"]) === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: getK8sPgWriteEnv("SSL_REJECT_UNAUTHORIZED", [
        "PG_WRITE_SSL_REJECT_UNAUTHORIZED",
      ]) !== "false",
    };
  }

  return dialectOptions;
}

function createPostgresWriteInstance() {
  const commonOptions = {
    dialect: "postgres",
    logging: getK8sPgWriteEnv("LOGGING", ["PG_WRITE_LOGGING"]) === "true",
    timezone: "+00:00",
    pool: {
      max: Number(getK8sPgWriteEnv("POOL_MAX", ["PG_WRITE_POOL_MAX"]) || 2),
      min: Number(getK8sPgWriteEnv("POOL_MIN", ["PG_WRITE_POOL_MIN"]) || 0),
      idle: 10000,
      acquire: 10000,
    },
    dialectOptions: buildDialectOptions(),
  };

  const writeUrl = getK8sWriteUrl();
  if (writeUrl) {
    return new Sequelize(writeUrl, commonOptions);
  }

  const objectConfig = getK8sWriteObjectConfig();
  if (!objectConfig) {
    const error = new Error(
      "K8s PG write env incomplete: require K8S_PG_WRITE_DATABASE_URL or K8S_PG_WRITE_HOST/K8S_PG_WRITE_DATABASE/K8S_PG_WRITE_USERNAME/K8S_PG_WRITE_PASSWORD"
    );
    error.code = "PG_WRITE_NOT_CONFIGURED";
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

function getPostgresWriteInstance() {
  if (!isPostgresWriteConfigured()) {
    const error = new Error("PG write connection is not configured");
    error.code = "PG_WRITE_NOT_CONFIGURED";
    throw error;
  }

  if (!pgWriteInstance) {
    pgWriteInstance = createPostgresWriteInstance();
  }

  return pgWriteInstance;
}

async function setupK8sPostgresWriteConnection() {
  setupState.configured = isPostgresWriteConfigured();
  setupState.checkedAt = new Date().toISOString();
  setupState.error = null;

  if (!setupState.configured) {
    setupState.ready = false;
    console.warn("[PG Write] skip setup: K8S_PG_WRITE_DATABASE_URL is not configured");
    return setupState;
  }

  try {
    const instance = getPostgresWriteInstance();
    await instance.authenticate();

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

    if (row.inRecovery || row.transactionReadOnly === "on") {
      const error = new Error(
        `[PG Write] expected primary writable database, but connected to ${row.serverAddr}:${row.serverPort} recovery=${row.inRecovery} readonly=${row.transactionReadOnly}`
      );
      error.code = "PG_WRITE_NOT_WRITABLE";
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
      `[PG Write] connected database=${row.databaseName} server=${row.serverAddr}:${row.serverPort} recovery=${row.inRecovery} readonly=${row.transactionReadOnly}`
    );

    return setupState;
  } catch (error) {
    setupState.ready = false;
    setupState.error = error.message;

    if (pgWriteInstance) {
      try {
        await pgWriteInstance.close();
      } catch (closeError) {
        console.warn("[PG Write] close failed after setup error:", closeError.message);
      } finally {
        pgWriteInstance = null;
      }
    }
    throw error;
  }
}

function getPostgresWriteStatus() {
  return { ...setupState };
}

module.exports = {
  getPostgresWriteInstance,
  getPostgresWriteStatus,
  isPostgresWriteConfigured,
  setupK8sPostgresWriteConnection,
};
