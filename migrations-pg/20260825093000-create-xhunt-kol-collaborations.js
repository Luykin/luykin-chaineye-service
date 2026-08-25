"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("XHuntKolCollaborations", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      authCenterUserId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      xhuntUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "XHuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      twitterId: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      twitterUsername: {
        type: Sequelize.STRING(128),
        allowNull: true,
      },
      acceptingNewInvitations: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      telegram: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      shortPostPrice: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: true,
      },
      shortPostCurrency: {
        type: Sequelize.STRING(8),
        allowNull: false,
        defaultValue: "USDT",
      },
      threadPrice: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: true,
      },
      threadCurrency: {
        type: Sequelize.STRING(8),
        allowNull: false,
        defaultValue: "USDT",
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.addIndex("XHuntKolCollaborations", ["authCenterUserId"], {
      unique: true,
      name: "ux_xhunt_kol_collaborations_auth_user",
    });
    await queryInterface.addIndex("XHuntKolCollaborations", ["twitterId"], {
      unique: true,
      name: "ux_xhunt_kol_collaborations_twitter_id",
    });
    await queryInterface.addIndex("XHuntKolCollaborations", ["acceptingNewInvitations"], {
      name: "idx_xhunt_kol_collaborations_accepting",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("XHuntKolCollaborations");
  },
};
