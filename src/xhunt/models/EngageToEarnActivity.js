const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'EngageToEarnActivity',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      activitySlug: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      externalId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      avatarImage: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      tweetLink: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      rewardLabel: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      rewardAmountUsd: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      startAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      limitProOnly: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      limitByFollowers: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      minFollowers: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      requiresEvmBound: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: DataTypes.ENUM(
          'announced',
          'not_started',
          'active',
          'signup_paused',
          'rewarding',
          'ended'
        ),
        allowNull: false,
        defaultValue: 'announced',
      },
    },
    {
      tableName: 'EngageToEarnActivities',
      timestamps: true,
      indexes: [
        { name: 'unique_activity_slug', unique: true, fields: ['activitySlug'] },
        { name: 'unique_external_id', unique: true, fields: ['externalId'] },
        { name: 'idx_time_range', fields: ['startAt', 'endAt'] },
        { name: 'idx_limit_flags', fields: ['limitProOnly', 'limitByFollowers'] },
        { name: 'idx_activity_status', fields: ['status'] },
      ],
      hooks: {
        beforeValidate: (instance) => {
          if (!instance.activitySlug && !instance.externalId) {
            throw new Error('Either activitySlug or externalId must be provided');
          }
        },
      },
    }
  );
};
