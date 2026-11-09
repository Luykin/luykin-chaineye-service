"use strict";

const FUNCTION_NAME = "prevent_xhunt_campaign_leaderboard_address_binding_mutation";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE'
          AND current_setting('xhunt.allow_campaign_registration_cascade_delete', true) = 'on'
        THEN
          RETURN OLD;
        END IF;

        RAISE EXCEPTION 'campaign leaderboard address bindings are immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'campaign leaderboard address bindings are immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);
  },
};
