const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningBoardAccess",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "看板授权记录 ID",
      },
      boardId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 EchohuntSocialListeningBoards.id",
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "被授权 EchoHunt 用户的 Twitter user id；用户已登录过时写入",
      },
      twitterHandle: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "被授权 EchoHunt 用户 X handle，去 @ 后统一小写；支持先按 handle 授权",
      },
      authCenterUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联 AuthCenterXhuntUsers.id；用户登录匹配后自动回填",
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "兼容关联旧 XHuntUsers.id，不作为主要授权依据",
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "active",
        comment: "授权状态：active/revoked；撤销后前台即时失效",
      },
      grantedByAdminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "授予授权的管理员 ID",
      },
      revokedByAdminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "撤销授权的管理员 ID",
      },
      grantedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: "授权生效时间",
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "授权撤销时间；为空表示未撤销",
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "授权扩展信息：来源、运营备注、首次匹配信息等",
      },
    },
    {
      tableName: "EchohuntSocialListeningBoardAccesses",
      timestamps: true,
      indexes: [
        { name: "idx_echohunt_sl_access_handle_status", fields: ["twitterHandle", "status"] },
        { name: "idx_echohunt_sl_access_auth_user_status", fields: ["authCenterUserId", "status"] },
        { name: "idx_echohunt_sl_access_board_status", fields: ["boardId", "status"] },
      ],
    }
  );
};
