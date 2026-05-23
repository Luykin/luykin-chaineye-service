'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('BinanceSquareUsers', 'aiOneLineIntroI18n', {
      type: DataTypes.JSONB,
      comment: 'AI生成的一句话用户介绍多语言内容，例如 { zh, en }',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('BinanceSquareUsers', 'aiOneLineIntroI18n');
  },
};
