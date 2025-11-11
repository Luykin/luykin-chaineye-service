const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'EngageToEarnSignup',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      xHuntUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'XHuntUsers',
          key: 'id',
        },
      },
      xHuntUserName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      activityId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'EngageToEarnActivities',
          key: 'id',
        },
      },
      activityTitle: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      tweetLink: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'EngageToEarnSignups',
      timestamps: true,
      indexes: [
        {
          name: 'unique_user_activity_signup',
          unique: true,
          fields: ['xHuntUserId', 'activityId'],
        },
        { name: 'idx_signup_user', fields: ['xHuntUserId'] },
        { name: 'idx_signup_activity', fields: ['activityId'] },
        { name: 'idx_signup_signedAt', fields: ['signedAt'] },
      ],
    }
  );
};
