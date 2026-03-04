const { DataTypes } = require("sequelize");

/**
 * XHuntWebUserToken Web 用户 Token 表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntWebUserToken",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "Token 记录唯一标识符",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "XHuntWebUsers",
          key: "id",
        },
        comment: "关联用户 ID（指向 XHuntWebUser）",
      },
      siteSource: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "站点来源标识（与用户表一致，用于验证）",
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "JWT Token",
      },
      fingerprint: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "设备指纹信息",
      },
      tokenExpiry: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "Token 过期时间",
      },
      lastUsed: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: "最后使用时间",
      },
      isRevoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否已被撤销",
      },
    },
    {
      tableName: "XHuntWebUserTokens",
      timestamps: true,
      indexes: [
        {
          name: "idx_web_user_id",
          fields: ["userId"],
        },
        {
          name: "idx_web_site_source",
          fields: ["siteSource"],
        },
        {
          name: "idx_web_token_expiry",
          fields: ["tokenExpiry"],
        },
      ],
    }
  );
};
