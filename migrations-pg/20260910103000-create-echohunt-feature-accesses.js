"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EchohuntFeatureAccesses", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      featureKey: { type: Sequelize.STRING(64), allowNull: false },
      resourceId: { type: Sequelize.STRING(128), allowNull: false, defaultValue: "global" },
      twitterId: { type: Sequelize.STRING(64), allowNull: true },
      twitterHandle: { type: Sequelize.STRING(64), allowNull: false },
      authCenterUserId: {
        type: Sequelize.UUID, allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL",
      },
      xhuntUserId: {
        type: Sequelize.UUID, allowNull: true,
        references: { model: "XHuntUsers", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL",
      },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
      grantedByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      revokedByAdminId: { type: Sequelize.INTEGER, allowNull: true },
      grantedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("EchohuntFeatureAccesses", ["featureKey", "resourceId", "twitterHandle"], {
      name: "ux_echohunt_feature_access_active_scope_handle", unique: true, where: { status: "active" },
    });
    await queryInterface.addIndex("EchohuntFeatureAccesses", ["featureKey", "resourceId", "authCenterUserId", "status"], { name: "idx_echohunt_feature_access_subject" });
    await queryInterface.addIndex("EchohuntFeatureAccesses", ["featureKey", "resourceId", "twitterId", "status"], { name: "idx_echohunt_feature_access_twitter" });

    await queryInterface.sequelize.query(`
      INSERT INTO "EchohuntFeatureAccesses" (
        "id", "featureKey", "resourceId", "twitterId", "twitterHandle", "authCenterUserId", "xhuntUserId",
        "status", "grantedByAdminId", "revokedByAdminId", "grantedAt", "revokedAt", "metadata", "createdAt", "updatedAt"
      )
      SELECT
        "id", 'social-listening', "boardId"::text, "twitterId", "twitterHandle", "authCenterUserId", "xhuntUserId",
        "status", "grantedByAdminId", "revokedByAdminId", "grantedAt", "revokedAt", "metadata", "createdAt", "updatedAt"
      FROM "EchohuntSocialListeningBoardAccesses"
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "EchohuntSocialListeningAccessAuditLogs"
      DROP CONSTRAINT IF EXISTS "EchohuntSocialListeningAccessAuditLogs_accessId_fkey"
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "EchohuntSocialListeningAccessAuditLogs"
      ADD CONSTRAINT "EchohuntSocialListeningAccessAuditLogs_accessId_fkey"
      FOREIGN KEY ("accessId") REFERENCES "EchohuntFeatureAccesses"("id")
      ON UPDATE CASCADE ON DELETE SET NULL
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE "EchohuntSocialListeningAccessAuditLogs" audit
      SET "accessId" = NULL
      WHERE "accessId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "EchohuntSocialListeningBoardAccesses" legacy WHERE legacy."id" = audit."accessId")
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "EchohuntSocialListeningAccessAuditLogs"
      DROP CONSTRAINT IF EXISTS "EchohuntSocialListeningAccessAuditLogs_accessId_fkey"
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "EchohuntSocialListeningAccessAuditLogs"
      ADD CONSTRAINT "EchohuntSocialListeningAccessAuditLogs_accessId_fkey"
      FOREIGN KEY ("accessId") REFERENCES "EchohuntSocialListeningBoardAccesses"("id")
      ON UPDATE CASCADE ON DELETE SET NULL
    `);
    await queryInterface.dropTable("EchohuntFeatureAccesses");
  },
};
