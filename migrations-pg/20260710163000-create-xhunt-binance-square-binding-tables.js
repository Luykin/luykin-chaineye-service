"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("XHuntBinanceSquareBindings", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      twitterId: { type: Sequelize.STRING(64), allowNull: false },
      twitterUsername: { type: Sequelize.STRING(128), allowNull: true },
      xhuntUserId: { type: Sequelize.UUID, allowNull: true },
      authCenterUserId: { type: Sequelize.UUID, allowNull: true },
      binanceSquareUid: { type: Sequelize.STRING(128), allowNull: false },
      binanceUsername: { type: Sequelize.STRING(128), allowNull: false },
      binanceDisplayName: { type: Sequelize.STRING(256), allowNull: true },
      binanceAvatar: { type: Sequelize.TEXT, allowNull: true },
      verificationPostId: { type: Sequelize.STRING(128), allowNull: false },
      verificationPostUrl: { type: Sequelize.TEXT, allowNull: false },
      verificationCode: { type: Sequelize.STRING(32), allowNull: false },
      verifiedAt: { type: Sequelize.DATE, allowNull: false },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
      rawAuthorData: { type: Sequelize.JSONB, allowNull: true },
      rawPostData: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.createTable("XHuntBinanceSquareBindingChallenges", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      twitterId: { type: Sequelize.STRING(64), allowNull: false },
      twitterUsername: { type: Sequelize.STRING(128), allowNull: true },
      xhuntUserId: { type: Sequelize.UUID, allowNull: true },
      authCenterUserId: { type: Sequelize.UUID, allowNull: true },
      verificationCode: { type: Sequelize.STRING(32), allowNull: false },
      verificationText: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      verifiedAt: { type: Sequelize.DATE, allowNull: true },
      attemptCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      lastAttemptAt: { type: Sequelize.DATE, allowNull: true },
      lastPostUrl: { type: Sequelize.TEXT, allowNull: true },
      lastPostId: { type: Sequelize.STRING(128), allowNull: true },
      lastErrorCode: { type: Sequelize.STRING(64), allowNull: true },
      lastErrorMessage: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.createTable("XHuntBinanceSquareBindingEvents", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      twitterId: { type: Sequelize.STRING(64), allowNull: false },
      eventType: { type: Sequelize.STRING(32), allowNull: false },
      fromBinanceSquareUid: { type: Sequelize.STRING(128), allowNull: true },
      toBinanceSquareUid: { type: Sequelize.STRING(128), allowNull: true },
      bindingId: { type: Sequelize.INTEGER, allowNull: true },
      challengeId: { type: Sequelize.INTEGER, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.addIndex("XHuntBinanceSquareBindings", ["twitterId", "status"], { name: "idx_xhunt_bs_bindings_twitter_status" });
    await queryInterface.addIndex("XHuntBinanceSquareBindings", ["binanceSquareUid", "status"], { name: "idx_xhunt_bs_bindings_square_uid_status" });
    await queryInterface.addIndex("XHuntBinanceSquareBindings", ["binanceUsername", "status"], { name: "idx_xhunt_bs_bindings_username_status" });
    await queryInterface.addIndex("XHuntBinanceSquareBindings", ["verificationPostId"], { name: "idx_xhunt_bs_bindings_post_id" });
    await queryInterface.addIndex("XHuntBinanceSquareBindings", ["verifiedAt"], { name: "idx_xhunt_bs_bindings_verified_at" });

    await queryInterface.addIndex("XHuntBinanceSquareBindingChallenges", ["twitterId", "status"], { name: "idx_xhunt_bs_challenges_twitter_status" });
    await queryInterface.addIndex("XHuntBinanceSquareBindingChallenges", ["verificationCode"], { name: "idx_xhunt_bs_challenges_code" });
    await queryInterface.addIndex("XHuntBinanceSquareBindingChallenges", ["expiresAt"], { name: "idx_xhunt_bs_challenges_expires" });
    await queryInterface.addIndex("XHuntBinanceSquareBindingChallenges", ["lastPostId"], { name: "idx_xhunt_bs_challenges_post_id" });

    await queryInterface.addIndex("XHuntBinanceSquareBindingEvents", ["twitterId", "eventType", "createdAt"], { name: "idx_xhunt_bs_events_twitter_type_created" });
    await queryInterface.addIndex("XHuntBinanceSquareBindingEvents", ["bindingId"], { name: "idx_xhunt_bs_events_binding_id" });
    await queryInterface.addIndex("XHuntBinanceSquareBindingEvents", ["challengeId"], { name: "idx_xhunt_bs_events_challenge_id" });

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_xhunt_bs_binding_twitter_active"
      ON "XHuntBinanceSquareBindings" ("twitterId")
      WHERE "status" = 'active';
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_xhunt_bs_binding_square_uid_active"
      ON "XHuntBinanceSquareBindings" ("binanceSquareUid")
      WHERE "status" = 'active';
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("XHuntBinanceSquareBindingEvents");
    await queryInterface.dropTable("XHuntBinanceSquareBindingChallenges");
    await queryInterface.dropTable("XHuntBinanceSquareBindings");
  },
};
