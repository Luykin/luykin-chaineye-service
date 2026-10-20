'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;
    await queryInterface.addColumn('xhunt_special_user_markers', 'marker_text_en', {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '英文标记文本，如：Suspected Scam',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('xhunt_special_user_markers', 'marker_text_en');
  },
};
