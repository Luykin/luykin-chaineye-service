const { DataTypes } = require("sequelize");

/**
 * XHuntUser 用户表（关联 Twitter 登录用户）
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntUser",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "用户唯一标识符",
      },
      twitterId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: "推特登录时给的 ID 字符串（全局唯一）",
      },
      username: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户登录名（可为空）",
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户显示名称",
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户头像 URL",
      },
      inviteCode: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: "用户的邀请码（可选）",
      },
      kolRank20W: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "KOL 影响力排名（20w 内的排名，非空表示入选）",
      },
      classification: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "分类（如 KOL、项目方、机构、个人等）",
      },
    },
    {
      tableName: "XHuntUsers", // 显式指定表名（可选）
      timestamps: true, // 启用 createdAt 和 updatedAt
      indexes: [
        {
          name: "idx_twitter_id",
          fields: ["twitterId"],
          unique: true,
        },
        {
          name: "idx_invite_code_unique",
          fields: ["inviteCode"],
          unique: true,
        },
        { name: "idx_kol_rank", fields: ["kolRank20W"] },
      ],
    }
  );
};
