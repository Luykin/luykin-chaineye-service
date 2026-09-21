const { DataTypes } = require("sequelize");

/**
 * XHuntHotVoteComment 议题留言表
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntHotVoteComment",
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
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "留言者推特ID (用户索引与投票身份严格对应)",
      },
      xHuntUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "XHuntUsers",
          key: "id",
        },
        comment: "必须登录才能留言",
      },
      userName: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      displayName: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      userAvatar: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      content: {
        type: DataTypes.STRING(200),
        allowNull: false,
        comment: "留言内容 (脱敏纯文本，限200字)",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "管理员屏蔽",
      },
    },
    {
      tableName: "XHuntHotVoteComments",
      timestamps: true,
      indexes: [
        {
          name: "idx_hot_vote_comments_topic_created",
          fields: ["topicId", "createdAt"],
        },
        {
          name: "idx_hot_vote_comments_twitter_id",
          fields: ["twitterId"],
        },
        {
          name: "idx_hot_vote_comments_topic_twitter",
          fields: ["topicId", "twitterId"],
        },
      ],
    }
  );
};
