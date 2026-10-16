const { buildPgConfig } = require("../src/utils/load-env");

module.exports = {
  development: buildPgConfig({
    defaultPort: 5433,
    logging: process.env.PG_LOGGING
      ? process.env.PG_LOGGING === "true"
        ? console.log
        : false
      : console.log,
  }),
  test: buildPgConfig({
    defaultPort: 5433,
    logging: process.env.PG_LOGGING
      ? process.env.PG_LOGGING === "true"
        ? console.log
        : false
      : console.log,
  }),
  production: buildPgConfig({
    defaultPort: 5432,
    logging: process.env.PG_LOGGING === "true" ? console.log : false,
  }),
};
