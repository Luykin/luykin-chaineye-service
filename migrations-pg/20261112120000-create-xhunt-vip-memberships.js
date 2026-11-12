'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes, QueryTypes } = Sequelize;

    await queryInterface.sequelize.transaction(async (transaction) => {
      const [integrity] = await queryInterface.sequelize.query(
        `SELECT
           COUNT(*) FILTER (WHERE "twitterId" IS NULL OR BTRIM("twitterId") = '')::int AS "missingCount",
           COUNT(*) FILTER (WHERE "twitterId" IS NOT NULL AND "twitterId" !~ '^[0-9]+$')::int AS "invalidCount"
         FROM xhunt_vip_test_users
         WHERE "listType" = 'vip'`,
        { type: QueryTypes.SELECT, transaction }
      );
      const duplicates = await queryInterface.sequelize.query(
        `SELECT "twitterId", COUNT(*)::int AS count
         FROM xhunt_vip_test_users
         WHERE "listType" = 'vip' AND "twitterId" IS NOT NULL
         GROUP BY "twitterId"
         HAVING COUNT(*) > 1
         LIMIT 10`,
        { type: QueryTypes.SELECT, transaction }
      );

      if (integrity.missingCount || integrity.invalidCount || duplicates.length) {
        throw new Error(
          `VIP X ID preflight failed: missing=${integrity.missingCount}, invalid=${integrity.invalidCount}, duplicate=${duplicates.length}`
        );
      }

      const [clock] = await queryInterface.sequelize.query(
        'SELECT CURRENT_TIMESTAMP AS "cutoverAt"',
        { type: QueryTypes.SELECT, transaction }
      );

      await queryInterface.changeColumn('xhunt_vip_test_users', 'username', {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Twitter 用户名快照（小写存储）',
      }, { transaction });
      await queryInterface.addColumn('xhunt_vip_test_users', 'vipExpiresAt', {
        type: DataTypes.DATE,
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn('xhunt_vip_test_users', 'vipOrigin', {
        type: DataTypes.STRING(32),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn('xhunt_vip_test_users', 'vipLastApiGrantedAt', {
        type: DataTypes.DATE,
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn('xhunt_vip_test_users', 'vipLastApiOrderNo', {
        type: DataTypes.STRING(128),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn('xhunt_vip_test_users', 'vipForceExpiredAt', {
        type: DataTypes.DATE,
        allowNull: true,
      }, { transaction });

      await queryInterface.sequelize.query(
        `UPDATE xhunt_vip_test_users
         SET "vipOrigin" = 'legacy_manual',
             "vipExpiresAt" = CAST(:cutoverAt AS TIMESTAMPTZ) + INTERVAL '6 months'
         WHERE "listType" = 'vip'`,
        { replacements: { cutoverAt: clock.cutoverAt }, transaction }
      );

      await queryInterface.addConstraint('xhunt_vip_test_users', {
        fields: ['listType', 'twitterId', 'vipExpiresAt', 'vipOrigin'],
        type: 'check',
        name: 'chk_xhunt_vip_membership_fields',
        where: {
          [Sequelize.Op.or]: [
            { listType: { [Sequelize.Op.ne]: 'vip' } },
            {
              twitterId: { [Sequelize.Op.ne]: null },
              vipExpiresAt: { [Sequelize.Op.ne]: null },
              vipOrigin: { [Sequelize.Op.in]: ['legacy_manual', 'membership_api'] },
            },
          ],
        },
        transaction,
      });
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_xhunt_vip_test_users_vip_twitter_id
         ON xhunt_vip_test_users ("twitterId")
         WHERE "listType" = 'vip' AND "twitterId" IS NOT NULL`,
        { transaction }
      );

      await queryInterface.createTable('xhunt_vip_operations', {
        id: { type: DataTypes.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
        clientKey: { type: DataTypes.STRING(64), allowNull: false },
        orderNo: { type: DataTypes.STRING(128), allowNull: false },
        action: { type: DataTypes.STRING(32), allowNull: false },
        twitterId: { type: DataTypes.STRING(64), allowNull: false },
        requestedExpiresAt: { type: DataTypes.DATE, allowNull: true },
        requestHash: { type: DataTypes.STRING(64), allowNull: false },
        previousExpiresAt: { type: DataTypes.DATE, allowNull: true },
        resultExpiresAt: { type: DataTypes.DATE, allowNull: false },
        executedAt: { type: DataTypes.DATE, allowNull: false },
        requestId: { type: DataTypes.STRING(128), allowNull: false },
        responseJson: { type: DataTypes.JSONB, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('xhunt_vip_operations', ['clientKey', 'orderNo'], {
        unique: true,
        name: 'uq_xhunt_vip_operations_client_order',
        transaction,
      });
      await queryInterface.addIndex('xhunt_vip_operations', ['twitterId', 'executedAt'], {
        name: 'idx_xhunt_vip_operations_twitter_executed',
        transaction,
      });

      await queryInterface.createTable('xhunt_vip_api_call_logs', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        clientKey: { type: DataTypes.STRING(64), allowNull: true },
        requestId: { type: DataTypes.STRING(128), allowNull: true },
        orderNo: { type: DataTypes.STRING(128), allowNull: true },
        action: { type: DataTypes.STRING(32), allowNull: false },
        twitterId: { type: DataTypes.STRING(64), allowNull: true },
        targetCount: { type: DataTypes.INTEGER, allowNull: true },
        requestHash: { type: DataTypes.STRING(64), allowNull: true },
        httpStatus: { type: DataTypes.INTEGER, allowNull: false },
        errorCode: { type: DataTypes.STRING(64), allowNull: true },
        replayed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        durationMs: { type: DataTypes.INTEGER, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      }, { transaction });
      await queryInterface.addIndex('xhunt_vip_api_call_logs', ['createdAt'], {
        name: 'idx_xhunt_vip_api_logs_created_at',
        transaction,
      });
      await queryInterface.addIndex('xhunt_vip_api_call_logs', ['clientKey', 'createdAt'], {
        name: 'idx_xhunt_vip_api_logs_client_created',
        transaction,
      });

      await queryInterface.sequelize.query('DROP TABLE IF EXISTS "XHuntUserProSubscriptions" CASCADE', { transaction });
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable('XHuntUserProSubscriptions', {
        id: { type: DataTypes.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
        userId: { type: DataTypes.UUID, allowNull: false, references: { model: 'XHuntUsers', key: 'id' } },
        startTime: { type: DataTypes.DATE, allowNull: false },
        endTime: { type: DataTypes.DATE, allowNull: false },
        planType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'vip-base' },
        reason: { type: DataTypes.STRING, allowNull: true },
        reasonDetail: { type: DataTypes.TEXT, allowNull: true },
        pluginVersion: { type: DataTypes.STRING, allowNull: true },
        pageUrl: { type: DataTypes.TEXT, allowNull: true },
        proInviteCode: { type: DataTypes.STRING, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('XHuntUserProSubscriptions', ['userId'], {
        name: 'idx_pro_subscription_user_id',
        transaction,
      });
      await queryInterface.addIndex('XHuntUserProSubscriptions', ['endTime'], {
        name: 'idx_pro_subscription_end_time',
        transaction,
      });
      await queryInterface.addIndex('XHuntUserProSubscriptions', ['userId', 'endTime'], {
        name: 'idx_pro_subscription_user_end_time',
        transaction,
      });
      await queryInterface.addIndex('XHuntUserProSubscriptions', ['planType'], {
        name: 'idx_pro_subscription_plan_type',
        transaction,
      });
      await queryInterface.dropTable('xhunt_vip_api_call_logs', { transaction });
      await queryInterface.dropTable('xhunt_vip_operations', { transaction });
      await queryInterface.removeIndex('xhunt_vip_test_users', 'uq_xhunt_vip_test_users_vip_twitter_id', { transaction });
      await queryInterface.removeConstraint('xhunt_vip_test_users', 'chk_xhunt_vip_membership_fields', { transaction });
      for (const column of ['vipForceExpiredAt', 'vipLastApiOrderNo', 'vipLastApiGrantedAt', 'vipOrigin', 'vipExpiresAt']) {
        await queryInterface.removeColumn('xhunt_vip_test_users', column, { transaction });
      }
      await queryInterface.sequelize.query(
        `UPDATE xhunt_vip_test_users
         SET username = "twitterId"
         WHERE username IS NULL`,
        { transaction }
      );
      await queryInterface.changeColumn('xhunt_vip_test_users', 'username', {
        type: DataTypes.STRING(255),
        allowNull: false,
      }, { transaction });
    });
  },
};
