'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('XHuntHotVoteTopics', 'titleI18n', {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: '标题多语言内容，例如 { zh, en }',
    });

    await queryInterface.addColumn('XHuntHotVoteTopics', 'summaryI18n', {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: '核心冲突介绍多语言内容，例如 { zh, en }',
    });

    // 存量数据回填：将现有纯文本字段作为 zh 版本
    await queryInterface.sequelize.query(`
      UPDATE "XHuntHotVoteTopics"
      SET "titleI18n" = jsonb_build_object('zh', "title"),
          "summaryI18n" = jsonb_build_object('zh', "summary")
      WHERE "titleI18n" IS NULL OR "summaryI18n" IS NULL
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('XHuntHotVoteTopics', 'summaryI18n');
    await queryInterface.removeColumn('XHuntHotVoteTopics', 'titleI18n');
  },
};
