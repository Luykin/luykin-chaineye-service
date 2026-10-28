const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Sequelize } = require("sequelize");

const migration = require(path.resolve(
  __dirname,
  "../migrations-pg/20261028100000-create-echohunt-e2e-scoring-settings.js"
));

test("E2E 评分配置迁移可以生成包含 JSONB 初始值的 PostgreSQL SQL", async () => {
  const sequelize = new Sequelize("postgres://user:pass@127.0.0.1:5432/db", {
    dialect: "postgres",
    logging: false,
  });
  const generator = sequelize.getQueryInterface().queryGenerator;
  const transaction = { id: "migration-test-transaction" };
  const generatedSql = [];
  const calls = [];
  const queryInterface = {
    sequelize: {
      transaction: async (callback) => callback(transaction),
    },
    async createTable(tableName, attributes, options = {}) {
      calls.push({ method: "createTable", options });
      const sqlAttributes = generator.attributesToSQL(attributes, {
        context: "createTable",
        table: tableName,
      });
      generatedSql.push(generator.createTableQuery(tableName, sqlAttributes, options));
    },
    async bulkInsert(tableName, records, options = {}, attributes) {
      calls.push({ method: "bulkInsert", options });
      generatedSql.push(generator.bulkInsertQuery(tableName, records, options, attributes));
    },
  };

  try {
    await migration.up(queryInterface, Sequelize);
  } finally {
    await sequelize.close();
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.transaction, transaction);
  assert.equal(calls[1].options.transaction, transaction);
  assert.equal(calls[1].options.ignoreDuplicates, true);
  assert.match(generatedSql[0], /CREATE TABLE IF NOT EXISTS/);
  assert.match(generatedSql[1], /"config"/);
  assert.match(generatedSql[1], /"timeDecayFloor":0\.7/);
  assert.match(generatedSql[1], /ON CONFLICT DO NOTHING/);
});
