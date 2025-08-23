const { DataTypes } = require("sequelize");

/**
 * XPrivateMessage 私信表
 * 存储用户之间的私信消息，支持富文本内容和定时展示
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XPrivateMessage",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "私信唯一标识",
      },
      senderId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "发信人的 XHuntUser.id",
      },
      receiverId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "收信人的 XHuntUser.id",
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "信息标题",
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "信息内容（富文本）",
      },
      displayAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "前端可展示的时间（定时展示）",
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: "发信息的时间（创建时间）",
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "已读未读状态（false=未读，true=已读）",
      },
      campaignId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "活动标识，用于避免同一活动重复发送消息",
      },
    },
    {
      tableName: "XPrivateMessages",
      timestamps: true,
      indexes: [
        { name: "idx_private_message_sender", fields: ["senderId"] },
        { name: "idx_private_message_receiver", fields: ["receiverId"] },
        { name: "idx_private_message_display_at", fields: ["displayAt"] },
        { name: "idx_private_message_sent_at", fields: ["sentAt"] },
        { name: "idx_private_message_is_read", fields: ["isRead"] },
        {
          name: "idx_private_message_receiver_read",
          fields: ["receiverId", "isRead"],
        },
        {
          name: "idx_private_message_display_sent",
          fields: ["displayAt", "sentAt"],
        },
        {
          name: "idx_private_message_campaign",
          fields: ["campaignId"],
        },
        {
          name: "idx_private_message_receiver_campaign",
          fields: ["receiverId", "campaignId"],
        },
      ],
    }
  );
};
