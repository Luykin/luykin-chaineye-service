const { DataTypes } = require("sequelize");

/**
 * XHuntHotVoteRecord 用户投票流水表
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntHotVoteRecord",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      topicId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "XHuntHotVoteTopics",
          key: "id",
        },
        comment: "所属议题ID",
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "推特唯一ID (唯一身份标识，不依赖登录)",
      },
      xHuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "XHuntUsers",
          key: "id",
        },
        comment: "XHunt 用户 ID (若已登录则关联)",
      },
      optionId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: "当前支持的选项ID",
      },
      previousOptionId: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: "上一次支持的选项ID",
      },
      revoteCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "已修改次数",
      },
      clientIp: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: "XHuntHotVoteRecords",
      timestamps: true,
      indexes: [
        {
          name: "uk_hot_vote_topic_twitter_id",
          unique: true,
          fields: ["topicId", "twitterId"],
          comment: "同一推特用户在同一议题下唯一",
        },
        { fields: ["topicId", "optionId"] },
        { fields: ["twitterId"] },
      ],
    }
  );
};
