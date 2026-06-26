"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("AuthCenterXhuntUsers", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      accountName: { type: Sequelize.STRING(64), allowNull: true, comment: "用户自己设置的账户名" },
      accountNameLower: { type: Sequelize.STRING(64), allowNull: true, comment: "小写账户名" },
      displayName: { type: Sequelize.STRING(255), allowNull: true },
      avatar: { type: Sequelize.STRING(2048), allowNull: true },
      primaryTwitterId: { type: Sequelize.STRING(64), allowNull: true },
      primaryGoogleEmail: { type: Sequelize.STRING(255), allowNull: true },
      primaryEvmAddress: { type: Sequelize.STRING(64), allowNull: true },
      xhuntUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "XHuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
      lastLoginAt: { type: Sequelize.DATE, allowNull: true },
      loginCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("AuthCenterXhuntClients", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      clientKey: { type: Sequelize.STRING(128), allowNull: false },
      clientName: { type: Sequelize.STRING(255), allowNull: false },
      clientType: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "public" },
      clientSecretHash: { type: Sequelize.TEXT, allowNull: true },
      allowedRedirectUris: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      allowedOrigins: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      allowedScopes: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: ["openid", "profile", "xhunt.basic"],
      },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("AuthCenterXhuntIdentities", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      provider: { type: Sequelize.STRING(32), allowNull: false },
      providerSubject: { type: Sequelize.STRING(255), allowNull: false },
      providerSubjectLower: { type: Sequelize.STRING(255), allowNull: false },
      username: { type: Sequelize.STRING(255), allowNull: true },
      displayName: { type: Sequelize.STRING(255), allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      emailVerified: { type: Sequelize.BOOLEAN, allowNull: true },
      avatar: { type: Sequelize.STRING(2048), allowNull: true },
      accessTokenEncrypted: { type: Sequelize.TEXT, allowNull: true },
      refreshTokenEncrypted: { type: Sequelize.TEXT, allowNull: true },
      tokenExpiry: { type: Sequelize.DATE, allowNull: true },
      isPrimary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("AuthCenterXhuntPasswordCredentials", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      usernameLower: { type: Sequelize.STRING(64), allowNull: false },
      passwordHash: { type: Sequelize.TEXT, allowNull: false },
      passwordAlgo: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "bcrypt" },
      passwordVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      failedAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      lockedUntil: { type: Sequelize.DATE, allowNull: true },
      passwordChangedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("AuthCenterXhuntSessions", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      clientId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntClients", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      clientKey: { type: Sequelize.STRING(128), allowNull: true },
      refreshTokenHash: { type: Sequelize.STRING(128), allowNull: false },
      accessTokenJti: { type: Sequelize.STRING(128), allowNull: true },
      fingerprint: { type: Sequelize.TEXT, allowNull: true },
      userAgent: { type: Sequelize.TEXT, allowNull: true },
      ipHash: { type: Sequelize.STRING(128), allowNull: true },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      revokeReason: { type: Sequelize.STRING(128), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("AuthCenterXhuntAuthorizationCodes", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      codeHash: { type: Sequelize.STRING(128), allowNull: false },
      clientId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntClients", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      redirectUri: { type: Sequelize.TEXT, allowNull: false },
      scope: { type: Sequelize.STRING(512), allowNull: true },
      codeChallenge: { type: Sequelize.STRING(255), allowNull: true },
      codeChallengeMethod: { type: Sequelize.STRING(32), allowNull: true },
      nonce: { type: Sequelize.STRING(255), allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      consumedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.createTable("AuthCenterXhuntAuditLogs", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      userId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      clientKey: { type: Sequelize.STRING(128), allowNull: true },
      eventType: { type: Sequelize.STRING(64), allowNull: false },
      provider: { type: Sequelize.STRING(32), allowNull: true },
      success: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      reason: { type: Sequelize.STRING(255), allowNull: true },
      fingerprint: { type: Sequelize.TEXT, allowNull: true },
      ipHash: { type: Sequelize.STRING(128), allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("AuthCenterXhuntUsers", ["accountNameLower"], {
      unique: true,
      name: "idx_auth_center_xhunt_users_account_name_lower",
    });
    await queryInterface.addIndex("AuthCenterXhuntUsers", ["xhuntUserId"], {
      name: "idx_auth_center_xhunt_users_xhunt_user_id",
    });
    await queryInterface.addIndex("AuthCenterXhuntUsers", ["primaryTwitterId"], {
      name: "idx_auth_center_xhunt_users_primary_twitter_id",
    });
    await queryInterface.addIndex("AuthCenterXhuntUsers", ["primaryEvmAddress"], {
      name: "idx_auth_center_xhunt_users_primary_evm_address",
    });
    await queryInterface.addIndex("AuthCenterXhuntUsers", ["status"], {
      name: "idx_auth_center_xhunt_users_status",
    });

    await queryInterface.addIndex("AuthCenterXhuntClients", ["clientKey"], {
      unique: true,
      name: "ux_auth_center_xhunt_clients_client_key",
    });
    await queryInterface.addIndex("AuthCenterXhuntClients", ["isActive"], {
      name: "idx_auth_center_xhunt_clients_is_active",
    });

    await queryInterface.addIndex("AuthCenterXhuntIdentities", ["provider", "providerSubjectLower"], {
      unique: true,
      name: "ux_auth_center_xhunt_identity_provider_subject",
    });
    await queryInterface.addIndex("AuthCenterXhuntIdentities", ["userId", "provider"], {
      unique: true,
      name: "ux_auth_center_xhunt_identity_user_provider",
    });
    await queryInterface.addIndex("AuthCenterXhuntIdentities", ["userId"], {
      name: "idx_auth_center_xhunt_identity_user_id",
    });

    await queryInterface.addIndex("AuthCenterXhuntPasswordCredentials", ["userId"], {
      unique: true,
      name: "ux_auth_center_xhunt_password_user_id",
    });
    await queryInterface.addIndex("AuthCenterXhuntPasswordCredentials", ["usernameLower"], {
      unique: true,
      name: "ux_auth_center_xhunt_password_username_lower",
    });
    await queryInterface.addIndex("AuthCenterXhuntPasswordCredentials", ["lockedUntil"], {
      name: "idx_auth_center_xhunt_password_locked_until",
    });

    await queryInterface.addIndex("AuthCenterXhuntSessions", ["userId"], {
      name: "idx_auth_center_xhunt_sessions_user_id",
    });
    await queryInterface.addIndex("AuthCenterXhuntSessions", ["clientId"], {
      name: "idx_auth_center_xhunt_sessions_client_id",
    });
    await queryInterface.addIndex("AuthCenterXhuntSessions", ["expiresAt"], {
      name: "idx_auth_center_xhunt_sessions_expires_at",
    });
    await queryInterface.addIndex("AuthCenterXhuntSessions", ["revokedAt"], {
      name: "idx_auth_center_xhunt_sessions_revoked_at",
    });
    await queryInterface.addIndex("AuthCenterXhuntSessions", ["refreshTokenHash"], {
      unique: true,
      name: "ux_auth_center_xhunt_sessions_refresh_hash",
    });

    await queryInterface.addIndex("AuthCenterXhuntAuthorizationCodes", ["codeHash"], {
      unique: true,
      name: "ux_auth_center_xhunt_codes_code_hash",
    });
    await queryInterface.addIndex("AuthCenterXhuntAuthorizationCodes", ["clientId", "userId"], {
      name: "idx_auth_center_xhunt_codes_client_user",
    });
    await queryInterface.addIndex("AuthCenterXhuntAuthorizationCodes", ["expiresAt"], {
      name: "idx_auth_center_xhunt_codes_expires_at",
    });

    await queryInterface.addIndex("AuthCenterXhuntAuditLogs", ["userId"], {
      name: "idx_auth_center_xhunt_audit_user_id",
    });
    await queryInterface.addIndex("AuthCenterXhuntAuditLogs", ["eventType"], {
      name: "idx_auth_center_xhunt_audit_event_type",
    });
    await queryInterface.addIndex("AuthCenterXhuntAuditLogs", ["createdAt"], {
      name: "idx_auth_center_xhunt_audit_created_at",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("AuthCenterXhuntAuditLogs");
    await queryInterface.dropTable("AuthCenterXhuntAuthorizationCodes");
    await queryInterface.dropTable("AuthCenterXhuntSessions");
    await queryInterface.dropTable("AuthCenterXhuntPasswordCredentials");
    await queryInterface.dropTable("AuthCenterXhuntIdentities");
    await queryInterface.dropTable("AuthCenterXhuntClients");
    await queryInterface.dropTable("AuthCenterXhuntUsers");
  },
};
