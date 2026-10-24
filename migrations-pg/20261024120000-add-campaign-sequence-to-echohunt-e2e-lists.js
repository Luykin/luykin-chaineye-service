"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("EchohuntE2eLists", "campaign_sequence", {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addIndex(
      "EchohuntE2eLists",
      ["tweet_id", "user_id", "campaign_sequence"],
      {
        name: "ux_echohunt_e2e_lists_creator_sequence",
        unique: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "EchohuntE2eLists",
      "ux_echohunt_e2e_lists_creator_sequence"
    );
    await queryInterface.removeColumn("EchohuntE2eLists", "campaign_sequence");
  },
};
