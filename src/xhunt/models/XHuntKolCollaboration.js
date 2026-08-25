const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntKolCollaboration",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "KOL 商务合作设置唯一标识",
      },
      authCenterUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 AuthCenterXhuntUsers.id",
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联旧 XHuntUsers.id",
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "Twitter ID，一个 X 账号只对应一份商务合作设置",
      },
      twitterUsername: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "Twitter handle 快照，仅用于展示和排查",
      },
      acceptingNewInvitations: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "是否接受新的商务合作邀约",
      },
      telegram: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "商务合作 Telegram 联系方式",
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "商务合作 Email 联系方式",
      },
      shortPostPrice: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: true,
        comment: "短推参考报价",
      },
      shortPostCurrency: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: "USDT",
        comment: "短推报价币种：USDT/USD",
      },
      threadPrice: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: true,
        comment: "长推 / Thread 参考报价",
      },
      threadCurrency: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: "USDT",
        comment: "长推 / Thread 报价币种：USDT/USD",
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "扩展信息",
      },
    },
    {
      tableName: "XHuntKolCollaborations",
      timestamps: true,
      indexes: [
        { name: "ux_xhunt_kol_collaborations_auth_user", fields: ["authCenterUserId"], unique: true },
        { name: "ux_xhunt_kol_collaborations_twitter_id", fields: ["twitterId"], unique: true },
        { name: "idx_xhunt_kol_collaborations_accepting", fields: ["acceptingNewInvitations"] },
      ],
    }
  );
};
