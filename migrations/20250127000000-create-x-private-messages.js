"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("XPrivateMessages", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        comment: "私信唯一标识",
      },
      senderId: {
        type: Sequelize.UUID,
        allowNull: false,
        comment: "发信人的 XHuntUser.id",
        references: {
          model: "XHuntUsers",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      receiverId: {
        type: Sequelize.UUID,
        allowNull: false,
        comment: "收信人的 XHuntUser.id",
        references: {
          model: "XHuntUsers",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "信息标题",
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: "信息内容（富文本）",
      },
      displayAt: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: "前端可展示的时间（定时展示）",
      },
      sentAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
        comment: "发信息的时间（创建时间）",
      },
      isRead: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "已读未读状态（false=未读，true=已读）",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // 创建索引
    await queryInterface.addIndex("XPrivateMessages", ["senderId"], {
      name: "idx_private_message_sender",
    });

    await queryInterface.addIndex("XPrivateMessages", ["receiverId"], {
      name: "idx_private_message_receiver",
    });

    await queryInterface.addIndex("XPrivateMessages", ["displayAt"], {
      name: "idx_private_message_display_at",
    });

    await queryInterface.addIndex("XPrivateMessages", ["sentAt"], {
      name: "idx_private_message_sent_at",
    });

    await queryInterface.addIndex("XPrivateMessages", ["isRead"], {
      name: "idx_private_message_is_read",
    });

    await queryInterface.addIndex(
      "XPrivateMessages",
      ["receiverId", "isRead"],
      {
        name: "idx_private_message_receiver_read",
      }
    );

    await queryInterface.addIndex("XPrivateMessages", ["displayAt", "sentAt"], {
      name: "idx_private_message_display_sent",
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("XPrivateMessages");
  },
};
