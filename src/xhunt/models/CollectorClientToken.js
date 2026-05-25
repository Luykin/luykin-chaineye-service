const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const CollectorClientToken = sequelize.define(
    "CollectorClientToken",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "采集客户端 token 名称，例如 Windows RootData Tampermonkey",
      },
      tokenHash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        field: "token_hash",
        comment: "token 的 SHA-256 哈希，不保存明文",
      },
      tokenPrefix: {
        type: DataTypes.STRING(24),
        allowNull: false,
        field: "token_prefix",
        comment: "token 前缀，用于后台展示和审计定位",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "is_active",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "expires_at",
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_used_at",
      },
      createdByAdminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "created_by_admin_id",
      },
      createdByAdminEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "created_by_admin_email",
      },
    },
    {
      tableName: "CollectorClientTokens",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["token_hash"] },
        { fields: ["is_active", "expires_at"] },
      ],
    }
  );

  return CollectorClientToken;
};
