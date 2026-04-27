'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('xhunt_vip_test_users', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Twitter 用户名（小写存储）',
      },
      listType: {
        type: DataTypes.ENUM('vip', 'internal_test'),
        allowNull: false,
        comment: '名单类型：vip 或 internal_test',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // 联合唯一索引：同一个用户名在同一种名单中只能出现一次
    await queryInterface.addIndex('xhunt_vip_test_users', {
      fields: ['username', 'listType'],
      unique: true,
      name: 'idx_xhunt_vip_test_users_username_list_type',
    });

    // 按 listType 查询的索引
    await queryInterface.addIndex('xhunt_vip_test_users', {
      fields: ['listType'],
      name: 'idx_xhunt_vip_test_users_list_type',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('xhunt_vip_test_users');
  },
};
