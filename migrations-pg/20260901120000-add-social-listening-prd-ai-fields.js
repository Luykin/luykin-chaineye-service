"use strict";

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName);
  if (table[columnName]) {
    await queryInterface.removeColumn(tableName, columnName);
  }
}

async function commentColumn(queryInterface, tableName, columnName, comment) {
  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN "${tableName}"."${columnName}" IS ${queryInterface.sequelize.escape(comment)}`
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, "EchohuntSocialListeningPosts", "postZh", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await commentColumn(queryInterface, "EchohuntSocialListeningPosts", "postZh", "帖子中文全文翻译，由 Social Listening 本地 LLM tweet_summary_media 逻辑生成");

    await addColumnIfMissing(queryInterface, "EchohuntSocialListeningSnapshots", "topicTrends", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    await commentColumn(queryInterface, "EchohuntSocialListeningSnapshots", "topicTrends", "Top 3 主题在当前范围内的趋势序列");

    await addColumnIfMissing(queryInterface, "EchohuntSocialListeningSnapshots", "viewpoints", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await commentColumn(queryInterface, "EchohuntSocialListeningSnapshots", "viewpoints", "当前范围正面/负面观点聚合摘要");
  },

  async down(queryInterface) {
    await removeColumnIfExists(queryInterface, "EchohuntSocialListeningSnapshots", "viewpoints");
    await removeColumnIfExists(queryInterface, "EchohuntSocialListeningSnapshots", "topicTrends");
    await removeColumnIfExists(queryInterface, "EchohuntSocialListeningPosts", "postZh");
  },
};
