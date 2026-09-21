const { Sequelize } = require("sequelize");

const pgDialect = process.env.PG_DIALECT || "postgres";
const pgHost = process.env.PG_HOST;
const pgPort = process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : undefined;
const pgDatabase = process.env.PG_DATABASE;
const pgUsername = process.env.PG_USERNAME;
const pgPassword = process.env.PG_PASSWORD;

if (!pgHost || !pgDatabase || !pgUsername || !pgPassword) {
  throw new Error(
    "PostgreSQL env incomplete: require PG_HOST, PG_DATABASE, PG_USERNAME, PG_PASSWORD"
  );
}

const dialectOptions = {};
if (process.env.PG_SSL === "true") {
  dialectOptions.ssl = {
    require: true,
    rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
  };
}

const pgInstance = new Sequelize({
  dialect: pgDialect,
  host: pgHost,
  port: pgPort,
  database: pgDatabase,
  username: pgUsername,
  password: pgPassword,
  logging: process.env.PG_LOGGING === "true",
  timezone: "+00:00",
  pool: { max: 10, min: 0, idle: 10000, acquire: 20000 },
  dialectOptions,
});

async function setupPostgres() {
  try {
    await pgInstance.authenticate();
    console.log("postgres Database connection established.");
    // await pgInstance.sync();
    await pgInstance.sync({ alter: false });
    console.log("postgres Database synchronized.");
  } catch (error) {
    console.error("postgres Database setup error:", error);
    throw error;
  }
}

module.exports = {
  pgInstance,
  setupPostgres,
};
