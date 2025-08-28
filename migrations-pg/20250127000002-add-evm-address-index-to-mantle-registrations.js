"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 添加EVM地址索引
    await queryInterface.addIndex("MantleRegistrations", ["evmAddress"], {
      name: "idx_mantle_evm_address",
    });
  },

  async down(queryInterface, Sequelize) {
    // 删除EVM地址索引
    await queryInterface.removeIndex(
      "MantleRegistrations",
      "idx_mantle_evm_address"
    );
  },
};
