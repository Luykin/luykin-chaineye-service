"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex("EchohuntSocialListeningPosts", ["postCreatedAt"], {
      name: "idx_echohunt_sl_posts_retention_created",
      concurrently: true,
    });
    await queryInterface.addIndex("EchohuntSocialListeningSnapshots", ["generatedAt"], {
      name: "idx_echohunt_sl_snapshots_retention_generated",
      concurrently: true,
    });
    await queryInterface.addIndex("EchohuntSocialListeningAccountSignals", ["occurredAt"], {
      name: "idx_echohunt_sl_signals_retention_occurred",
      concurrently: true,
    });
    await queryInterface.addIndex("EchohuntSocialListeningAlerts", ["triggeredAt"], {
      name: "idx_echohunt_sl_alerts_retention_triggered",
      concurrently: true,
    });
    await queryInterface.addIndex("EchohuntSocialListeningTextCondensations", ["condensedAt"], {
      name: "idx_echohunt_sl_text_condensations_retention_condensed",
      concurrently: true,
    });
    await queryInterface.addIndex("EchohuntSocialListeningJobs", ["status", "finishedAt"], {
      name: "idx_echohunt_sl_jobs_retention_status_finished",
      concurrently: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("EchohuntSocialListeningPosts", "idx_echohunt_sl_posts_retention_created", { concurrently: true });
    await queryInterface.removeIndex("EchohuntSocialListeningSnapshots", "idx_echohunt_sl_snapshots_retention_generated", { concurrently: true });
    await queryInterface.removeIndex("EchohuntSocialListeningAccountSignals", "idx_echohunt_sl_signals_retention_occurred", { concurrently: true });
    await queryInterface.removeIndex("EchohuntSocialListeningAlerts", "idx_echohunt_sl_alerts_retention_triggered", { concurrently: true });
    await queryInterface.removeIndex("EchohuntSocialListeningTextCondensations", "idx_echohunt_sl_text_condensations_retention_condensed", { concurrently: true });
    await queryInterface.removeIndex("EchohuntSocialListeningJobs", "idx_echohunt_sl_jobs_retention_status_finished", { concurrently: true });
  },
};
