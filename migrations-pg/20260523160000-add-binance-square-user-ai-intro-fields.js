'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('BinanceSquareUsers', 'aiOneLineIntro', {
      type: DataTypes.TEXT,
      comment: 'AI生成的一句话用户介绍',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroStatus', {
      type: DataTypes.STRING(32),
      comment: 'AI介绍生成状态：pending/running/success/failed/skipped',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroModel', {
      type: DataTypes.STRING(128),
      comment: 'AI介绍生成使用的大模型',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroPromptVersion', {
      type: DataTypes.STRING(64),
      comment: 'AI介绍生成使用的Prompt版本',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroInputHash', {
      type: DataTypes.STRING(64),
      comment: 'AI介绍生成输入内容hash，用于判断是否需要重算',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroGeneratedAt', {
      type: DataTypes.DATE,
      comment: 'AI介绍生成时间',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroError', {
      type: DataTypes.TEXT,
      comment: 'AI介绍生成失败原因',
    });
    await queryInterface.addColumn('BinanceSquareUsers', 'aiIntroDetails', {
      type: DataTypes.JSONB,
      comment: 'AI介绍生成元数据，例如帖子数量、输入长度、任务ID等',
    });

    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['aiIntroStatus'],
      name: 'idx_binance_square_users_ai_intro_status',
    });
    await queryInterface.addIndex('BinanceSquareUsers', {
      fields: ['aiIntroGeneratedAt'],
      name: 'idx_binance_square_users_ai_intro_generated_at',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('BinanceSquareUsers', 'idx_binance_square_users_ai_intro_generated_at').catch(() => {});
    await queryInterface.removeIndex('BinanceSquareUsers', 'idx_binance_square_users_ai_intro_status').catch(() => {});

    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroDetails');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroError');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroGeneratedAt');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroInputHash');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroPromptVersion');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroModel');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiIntroStatus');
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiOneLineIntro');
  },
};
