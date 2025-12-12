"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    // Create enum types exactly as Sequelize would name them for models
    // Project.updateProgram -> enum_Projects_updateProgram
    // InvestmentRelationships.updateProgram -> enum_InvestmentRelationships_updateProgram
    await sequelize.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_Projects_updateProgram') THEN
          CREATE TYPE "enum_Projects_updateProgram" AS ENUM (
            'auto_crawler', 'manual_crawler', 'auto_api_fix', 'manual_api_fix', 'auto_crawler_fix'
          );
        END IF;
      END$$;`
    );

    await sequelize.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_InvestmentRelationships_updateProgram') THEN
          CREATE TYPE "enum_InvestmentRelationships_updateProgram" AS ENUM (
            'auto_crawler', 'manual_crawler', 'auto_api_fix', 'manual_api_fix', 'auto_crawler_fix'
          );
        END IF;
      END$$;`
    );

    // Add columns using the created enum types
    await sequelize.query(
      'ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS "updateProgram" "enum_Projects_updateProgram" NULL'
    );

    await sequelize.query(
      'ALTER TABLE "InvestmentRelationships" ADD COLUMN IF NOT EXISTS "updateProgram" "enum_InvestmentRelationships_updateProgram" NULL'
    );
  },

  async down(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;

    // Remove columns first
    await sequelize.query(
      'ALTER TABLE "InvestmentRelationships" DROP COLUMN IF EXISTS "updateProgram"'
    );
    await sequelize.query(
      'ALTER TABLE "Projects" DROP COLUMN IF EXISTS "updateProgram"'
    );

    // Drop enum types
    await sequelize.query(
      'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = ' +
        "'enum_InvestmentRelationships_updateProgram') THEN DROP TYPE \"enum_InvestmentRelationships_updateProgram\"; END IF; END$$;"
    );

    await sequelize.query(
      'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = ' +
        "'enum_Projects_updateProgram') THEN DROP TYPE \"enum_Projects_updateProgram\"; END IF; END$$;"
    );
  },
};
