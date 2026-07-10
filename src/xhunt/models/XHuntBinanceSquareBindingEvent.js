const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntBinanceSquareBindingEvent",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      eventType: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: "bind/rebind/unbind/verify_failed",
      },
      fromBinanceSquareUid: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      toBinanceSquareUid: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      bindingId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      challengeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "XHuntBinanceSquareBindingEvents",
      timestamps: true,
      indexes: [
        { name: "idx_xhunt_bs_events_twitter_type_created", fields: ["twitterId", "eventType", "createdAt"] },
        { name: "idx_xhunt_bs_events_binding_id", fields: ["bindingId"] },
        { name: "idx_xhunt_bs_events_challenge_id", fields: ["challengeId"] },
      ],
    }
  );
};
