"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.changeColumn("XHuntHotVoteComments", "xHuntUserId", {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "XHuntUsers",
        key: "id",
      },
      comment: "XHunt 用户 ID (登录用户关联，免登录为 null)",
    });

    await queryInterface.changeColumn("XHuntHotVoteComments", "userAvatar", {
      type: DataTypes.STRING(512),
      allowNull: true,
      defaultValue: "",
      comment: "用户头像",
    });

    await queryInterface.addColumn("XHuntHotVoteTopics", "summaryHtml", {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "富文本核心冲突介绍 (限1000字符，白名单HTML标签)",
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.removeColumn("XHuntHotVoteTopics", "summaryHtml");

    await queryInterface.changeColumn("XHuntHotVoteComments", "xHuntUserId", {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "XHuntUsers",
        key: "id",
      },
      comment: "必须登录才能留言",
    });

    await queryInterface.changeColumn("XHuntHotVoteComments", "userAvatar", {
      type: DataTypes.STRING(512),
      allowNull: false,
      comment: "用户头像",
    });
  },
};
