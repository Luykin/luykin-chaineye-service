"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 显式执行原生 DDL，绕过 Sequelize changeColumn 在包含 REFERENCES 时跳过 DROP NOT NULL 的已知缺陷
    await queryInterface.sequelize.query(
      'ALTER TABLE "XHuntHotVoteComments" ALTER COLUMN "xHuntUserId" DROP NOT NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE "XHuntHotVoteComments" ALTER COLUMN "userAvatar" DROP NOT NULL;'
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE "XHuntHotVoteComments" ALTER COLUMN "xHuntUserId" SET NOT NULL;'
    );
  },
};
