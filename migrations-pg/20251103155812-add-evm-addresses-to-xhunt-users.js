"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. 添加 evmAddresses 字段到 XHuntUsers 表
    await queryInterface.addColumn("XHuntUsers", "evmAddresses", {
      type: Sequelize.JSON,
      allowNull: true,
      comment: "用户绑定的多个 EVM 地址（数组格式）",
    });

    // 2. 将现有 NULL 值初始化为空数组
    await queryInterface.sequelize.query(`
      UPDATE "XHuntUsers"
      SET "evmAddresses" = '[]'::json
      WHERE "evmAddresses" IS NULL
    `);

    // 3. 从 MantleRegistrations 迁移初始数据
    // 查询所有有 evmAddress 的 MantleRegistration 记录，按用户分组
    const [results] = await queryInterface.sequelize.query(`
      SELECT 
        mr."xHuntUserId",
        mr."evmAddress"
      FROM "MantleRegistrations" mr
      WHERE mr."evmAddress" IS NOT NULL 
        AND mr."evmAddress" != ''
        AND mr."xHuntUserId" IS NOT NULL
      GROUP BY mr."xHuntUserId", mr."evmAddress"
      ORDER BY mr."xHuntUserId"
    `);

    // 按用户分组，收集每个用户的所有地址（去重）
    const userAddressMap = {};
    for (const row of results) {
      const userId = row.xHuntUserId;
      const evmAddress = String(row.evmAddress || "")
        .trim()
        .toLowerCase();
      // 验证地址格式（0x + 40个十六进制字符）
      if (!evmAddress || !/^0x[a-f0-9]{40}$/.test(evmAddress)) {
        continue;
      }

      if (!userAddressMap[userId]) {
        userAddressMap[userId] = new Set();
      }
      userAddressMap[userId].add(evmAddress);
    }

    // 更新每个用户的 evmAddresses 字段
    for (const [userId, addressSet] of Object.entries(userAddressMap)) {
      const addresses = Array.from(addressSet);
      await queryInterface.sequelize.query(
        `
        UPDATE "XHuntUsers"
        SET "evmAddresses" = :addresses::jsonb
        WHERE id = :userId
      `,
        {
          replacements: {
            addresses: JSON.stringify(addresses),
            userId: userId,
          },
        }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    // 删除 evmAddresses 字段
    await queryInterface.removeColumn("XHuntUsers", "evmAddresses");
  },
};
