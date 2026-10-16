const { buildPgConfig } = require("../src/utils/load-env");

const baseConfig = buildPgConfig({
  defaultPort: 5432,
  database: process.env.ROOTDATAPRO_PG_DATABASE || "rootdatapro",
  logging: process.env.PG_LOGGING === "true" ? console.log : false,
});

module.exports = {
  development: baseConfig,
  test: baseConfig,
  production: baseConfig,
};
