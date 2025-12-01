const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const XhuntAdminWebAuthnCredential = sequelize.define(
    "XhuntAdminWebAuthnCredential",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      adminId: { type: DataTypes.INTEGER, allowNull: false },
      credentialId: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      publicKey: { type: DataTypes.TEXT, allowNull: false },
      counter: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      transports: { type: DataTypes.JSONB, allowNull: true },
      aaguid: { type: DataTypes.STRING(64), allowNull: true },
      deviceType: { type: DataTypes.STRING(32), allowNull: true },
      backedUp: { type: DataTypes.BOOLEAN, allowNull: true },
      nickname: { type: DataTypes.STRING(64), allowNull: true },
      lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "xhunt_admin_webauthn_credentials",
      indexes: [
        { unique: true, fields: ["credentialId"] },
        { fields: ["adminId"] },
      ],
      timestamps: true,
    }
  );

  return XhuntAdminWebAuthnCredential;
};
