"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = "EchohuntSocialListeningTextCondensations";
    const tables = await queryInterface.showAllTables();
    if (!tables.includes(tableName)) {
      await queryInterface.createTable(tableName, {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
        tweetId: { type: Sequelize.STRING(64), allowNull: false, comment: "来源 X/Twitter tweet id；跨看板复用" },
        sourceTextHash: { type: Sequelize.STRING(64), allowNull: false, comment: "归一化原文 SHA-256；原文变化时缓存失效" },
        sourceTextLength: { type: Sequelize.INTEGER, allowNull: false, comment: "归一化原文字符数" },
        condensedText: { type: Sequelize.TEXT, allowNull: false, comment: "默认模型生成的长文精简内容" },
        model: { type: Sequelize.STRING(255), allowNull: true, comment: "生成精简内容所用的默认模型" },
        condensedAt: { type: Sequelize.DATE, allowNull: false, comment: "最近一次精简完成时间" },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      });
      await queryInterface.addIndex(tableName, ["tweetId"], {
        name: "ux_echohunt_sl_text_condensations_tweet",
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes("EchohuntSocialListeningTextCondensations")) {
      await queryInterface.dropTable("EchohuntSocialListeningTextCondensations");
    }
  },
};
