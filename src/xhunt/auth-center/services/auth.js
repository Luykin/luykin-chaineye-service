const bcrypt = require("bcryptjs");
const {
  normalizeAccountName,
  normalizeAccountNameLower,
  normalizeEvmAddress,
  extractEvm40Address,
} = require("./utils");

const PROVIDERS = {
  PASSWORD: "password",
  GOOGLE: "google",
  EVM: "evm",
  TWITTER: "twitter",
};

const ACCOUNT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/;
const RESERVED_ACCOUNT_NAMES = new Set([
  "admin",
  "root",
  "system",
  "xhunt",
  "auth",
  "support",
  "official",
]);

function validateAccountName(accountName) {
  const normalized = normalizeAccountName(accountName);
  const lower = normalized.toLowerCase();
  if (!ACCOUNT_NAME_PATTERN.test(normalized)) {
    return "INVALID_ACCOUNT_NAME";
  }
  if (RESERVED_ACCOUNT_NAMES.has(lower)) {
    return "ACCOUNT_NAME_RESERVED";
  }
  return null;
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8 || value.length > 128) {
    return "INVALID_PASSWORD_LENGTH";
  }
  return null;
}

async function findActiveClient(models, clientKey) {
  const key = String(clientKey || "xhunt-web").trim();
  if (!key) return null;
  const client = await models.AuthCenterXhuntClient.findOne({
    where: { clientKey: key, isActive: true },
  });
  return client || { id: null, clientKey: key };
}

async function loadUserIdentities(models, userId, transaction) {
  return models.AuthCenterXhuntIdentity.findAll({
    where: { userId },
    transaction,
    order: [["createdAt", "ASC"]],
  });
}

async function updateUserLoginStats(user, transaction) {
  await user.update(
    {
      lastLoginAt: new Date(),
      loginCount: (user.loginCount || 0) + 1,
    },
    { transaction }
  );
}

async function createAuditLog(models, req, payload) {
  try {
    const { getFingerprint, getIpHash } = require("./utils");
    await models.AuthCenterXhuntAuditLog.create({
      userId: payload.userId || null,
      clientKey: payload.clientKey || null,
      eventType: payload.eventType,
      provider: payload.provider || null,
      success: !!payload.success,
      reason: payload.reason || null,
      fingerprint: getFingerprint(req),
      ipHash: getIpHash(req),
      metadata: payload.metadata || null,
    });
  } catch (error) {
    console.warn("[AuthCenter] audit log failed:", error.message);
  }
}

async function registerWithPassword(models, { accountName, password }, transaction) {
  const normalized = normalizeAccountName(accountName);
  const lower = normalizeAccountNameLower(accountName);
  const accountError = validateAccountName(normalized);
  if (accountError) {
    const err = new Error(accountError);
    err.status = 400;
    throw err;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    const err = new Error(passwordError);
    err.status = 400;
    throw err;
  }

  const existed = await models.AuthCenterXhuntIdentity.findOne({
    where: { provider: PROVIDERS.PASSWORD, providerSubjectLower: lower },
    transaction,
  });
  if (existed) {
    const err = new Error("ACCOUNT_NAME_ALREADY_EXISTS");
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = await models.AuthCenterXhuntUser.create(
    {
      accountName: normalized,
      accountNameLower: lower,
      status: "active",
    },
    { transaction }
  );

  await models.AuthCenterXhuntIdentity.create(
    {
      userId: user.id,
      provider: PROVIDERS.PASSWORD,
      providerSubject: normalized,
      providerSubjectLower: lower,
      username: normalized,
      displayName: normalized,
      isPrimary: true,
      lastUsedAt: new Date(),
    },
    { transaction }
  );

  await models.AuthCenterXhuntPasswordCredential.create(
    {
      userId: user.id,
      usernameLower: lower,
      passwordHash,
      passwordAlgo: "bcrypt",
      passwordVersion: 1,
      passwordChangedAt: new Date(),
    },
    { transaction }
  );

  await updateUserLoginStats(user, transaction);
  const identities = await loadUserIdentities(models, user.id, transaction);
  return { user, identities, isNewUser: true };
}

async function loginWithPassword(models, { accountName, password }, transaction) {
  const lower = normalizeAccountNameLower(accountName);
  const credential = await models.AuthCenterXhuntPasswordCredential.findOne({
    where: { usernameLower: lower },
    include: [{ model: models.AuthCenterXhuntUser, as: "user" }],
    transaction,
  });

  if (!credential || !credential.user) {
    const err = new Error("INVALID_ACCOUNT_OR_PASSWORD");
    err.status = 401;
    throw err;
  }

  if (credential.user.status !== "active") {
    const err = new Error("USER_DISABLED");
    err.status = 403;
    throw err;
  }

  if (credential.lockedUntil && credential.lockedUntil > new Date()) {
    const err = new Error("ACCOUNT_LOCKED");
    err.status = 423;
    throw err;
  }

  const ok = await bcrypt.compare(String(password || ""), credential.passwordHash);
  if (!ok) {
    const failedAttempts = (credential.failedAttempts || 0) + 1;
    const update = { failedAttempts };
    if (failedAttempts >= 5) {
      update.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await credential.update(update, { transaction });
    const err = new Error("INVALID_ACCOUNT_OR_PASSWORD");
    err.status = 401;
    throw err;
  }

  await credential.update({ failedAttempts: 0, lockedUntil: null }, { transaction });
  await models.AuthCenterXhuntIdentity.update(
    { lastUsedAt: new Date() },
    { where: { userId: credential.userId, provider: PROVIDERS.PASSWORD }, transaction }
  );
  await updateUserLoginStats(credential.user, transaction);
  const identities = await loadUserIdentities(models, credential.userId, transaction);
  return { user: credential.user, identities, isNewUser: false };
}

async function upsertOAuthIdentityLogin(models, provider, profile, transaction) {
  const subjectLower = String(profile.providerSubjectLower || profile.providerSubject).toLowerCase();
  let identity = await models.AuthCenterXhuntIdentity.findOne({
    where: { provider, providerSubjectLower: subjectLower },
    include: [{ model: models.AuthCenterXhuntUser, as: "user" }],
    transaction,
  });

  let user;
  let isNewUser = false;

  if (identity) {
    user = identity.user;
    if (!user || user.status !== "active") {
      const err = new Error("USER_DISABLED");
      err.status = 403;
      throw err;
    }
    await identity.update(
      {
        username: profile.username || identity.username,
        displayName: profile.displayName || identity.displayName,
        email: profile.email || identity.email,
        emailVerified:
          typeof profile.emailVerified === "boolean" ? profile.emailVerified : identity.emailVerified,
        avatar: profile.avatar || identity.avatar,
        accessTokenEncrypted: profile.accessToken || identity.accessTokenEncrypted,
        refreshTokenEncrypted: profile.refreshToken || identity.refreshTokenEncrypted,
        tokenExpiry: profile.tokenExpiry || identity.tokenExpiry,
        lastUsedAt: new Date(),
      },
      { transaction }
    );
  } else {
    const userPayload = { status: "active" };
    if (provider === PROVIDERS.GOOGLE) {
      userPayload.primaryGoogleEmail = profile.email || null;
      userPayload.avatar = profile.avatar || null;
    }
    if (provider === PROVIDERS.EVM) {
      userPayload.primaryEvmAddress = subjectLower;
    }
    if (provider === PROVIDERS.TWITTER) {
      userPayload.primaryTwitterId = String(profile.providerSubject);
      userPayload.avatar = profile.avatar || null;
      const xhuntUser = await models.XHuntUser.findOne({
        where: { twitterId: String(profile.providerSubject) },
        transaction,
      });
      if (xhuntUser) {
        userPayload.xhuntUserId = xhuntUser.id;
      }
    }

    user = await models.AuthCenterXhuntUser.create(userPayload, { transaction });
    identity = await models.AuthCenterXhuntIdentity.create(
      {
        userId: user.id,
        provider,
        providerSubject: String(profile.providerSubject),
        providerSubjectLower: subjectLower,
        username: profile.username || null,
        displayName: profile.displayName || null,
        email: profile.email || null,
        emailVerified: typeof profile.emailVerified === "boolean" ? profile.emailVerified : null,
        avatar: profile.avatar || null,
        accessTokenEncrypted: profile.accessToken || null,
        refreshTokenEncrypted: profile.refreshToken || null,
        tokenExpiry: profile.tokenExpiry || null,
        isPrimary: true,
        lastUsedAt: new Date(),
      },
      { transaction }
    );
    isNewUser = true;
  }

  if (provider === PROVIDERS.TWITTER && !user.xhuntUserId) {
    const xhuntUser = await models.XHuntUser.findOne({
      where: { twitterId: String(profile.providerSubject) },
      transaction,
    });
    if (xhuntUser) {
      await user.update({ xhuntUserId: xhuntUser.id }, { transaction });
    }
  }

  if (provider === PROVIDERS.GOOGLE && profile.email && !user.primaryGoogleEmail) {
    await user.update({ primaryGoogleEmail: profile.email }, { transaction });
  }
  if (provider === PROVIDERS.EVM && !user.primaryEvmAddress) {
    await user.update({ primaryEvmAddress: subjectLower }, { transaction });
  }
  if (provider === PROVIDERS.TWITTER && !user.primaryTwitterId) {
    await user.update({ primaryTwitterId: String(profile.providerSubject) }, { transaction });
  }

  await updateUserLoginStats(user, transaction);
  const identities = await loadUserIdentities(models, user.id, transaction);
  return { user, identities, isNewUser };
}

async function bindPasswordIdentity(models, user, { accountName, password }, transaction) {
  const normalized = normalizeAccountName(accountName);
  const lower = normalizeAccountNameLower(accountName);
  const accountError = validateAccountName(normalized);
  if (accountError) {
    const err = new Error(accountError);
    err.status = 400;
    throw err;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    const err = new Error(passwordError);
    err.status = 400;
    throw err;
  }

  const current = await models.AuthCenterXhuntIdentity.findOne({
    where: { userId: user.id, provider: PROVIDERS.PASSWORD },
    transaction,
  });
  if (current) {
    const err = new Error("PASSWORD_ALREADY_SET");
    err.status = 409;
    throw err;
  }

  const occupied = await models.AuthCenterXhuntIdentity.findOne({
    where: { provider: PROVIDERS.PASSWORD, providerSubjectLower: lower },
    transaction,
  });
  if (occupied) {
    const err = new Error("ACCOUNT_NAME_ALREADY_EXISTS");
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  await models.AuthCenterXhuntIdentity.create(
    {
      userId: user.id,
      provider: PROVIDERS.PASSWORD,
      providerSubject: normalized,
      providerSubjectLower: lower,
      username: normalized,
      displayName: normalized,
      isPrimary: true,
      lastUsedAt: new Date(),
    },
    { transaction }
  );
  await models.AuthCenterXhuntPasswordCredential.create(
    {
      userId: user.id,
      usernameLower: lower,
      passwordHash,
      passwordAlgo: "bcrypt",
      passwordVersion: 1,
      passwordChangedAt: new Date(),
    },
    { transaction }
  );
  await user.update(
    {
      accountName: normalized,
      accountNameLower: lower,
    },
    { transaction }
  );

  const identities = await loadUserIdentities(models, user.id, transaction);
  return { user, identities };
}

async function bindOAuthIdentityToUser(models, user, provider, profile, transaction) {
  const subjectLower = String(profile.providerSubjectLower || profile.providerSubject).toLowerCase();
  const current = await models.AuthCenterXhuntIdentity.findOne({
    where: { userId: user.id, provider },
    transaction,
  });

  if (current && current.providerSubjectLower !== subjectLower) {
    const err = new Error("PROVIDER_ALREADY_BOUND_TO_USER");
    err.status = 409;
    throw err;
  }

  const occupied = await models.AuthCenterXhuntIdentity.findOne({
    where: { provider, providerSubjectLower: subjectLower },
    transaction,
  });
  if (occupied && occupied.userId !== user.id) {
    const err = new Error("IDENTITY_ALREADY_BOUND");
    err.status = 409;
    throw err;
  }

  if (current) {
    await current.update(
      {
        username: profile.username || current.username,
        displayName: profile.displayName || current.displayName,
        email: profile.email || current.email,
        emailVerified:
          typeof profile.emailVerified === "boolean" ? profile.emailVerified : current.emailVerified,
        avatar: profile.avatar || current.avatar,
        accessTokenEncrypted: profile.accessToken || current.accessTokenEncrypted,
        refreshTokenEncrypted: profile.refreshToken || current.refreshTokenEncrypted,
        tokenExpiry: profile.tokenExpiry || current.tokenExpiry,
        lastUsedAt: new Date(),
      },
      { transaction }
    );
  } else {
    await models.AuthCenterXhuntIdentity.create(
      {
        userId: user.id,
        provider,
        providerSubject: String(profile.providerSubject),
        providerSubjectLower: subjectLower,
        username: profile.username || null,
        displayName: profile.displayName || null,
        email: profile.email || null,
        emailVerified: typeof profile.emailVerified === "boolean" ? profile.emailVerified : null,
        avatar: profile.avatar || null,
        accessTokenEncrypted: profile.accessToken || null,
        refreshTokenEncrypted: profile.refreshToken || null,
        tokenExpiry: profile.tokenExpiry || null,
        isPrimary: true,
        lastUsedAt: new Date(),
      },
      { transaction }
    );
  }

  const updatePayload = {};
  if (provider === PROVIDERS.GOOGLE && profile.email) {
    updatePayload.primaryGoogleEmail = profile.email;
    if (!user.avatar && profile.avatar) updatePayload.avatar = profile.avatar;
  }
  if (provider === PROVIDERS.EVM) {
    updatePayload.primaryEvmAddress = subjectLower;
  }
  if (provider === PROVIDERS.TWITTER) {
    updatePayload.primaryTwitterId = String(profile.providerSubject);
    if (profile.avatar) updatePayload.avatar = profile.avatar;
    const xhuntUser = await models.XHuntUser.findOne({
      where: { twitterId: String(profile.providerSubject) },
      transaction,
    });
    updatePayload.xhuntUserId = xhuntUser ? xhuntUser.id : null;
  }
  if (Object.keys(updatePayload).length > 0) {
    await user.update(updatePayload, { transaction });
  }

  const identities = await loadUserIdentities(models, user.id, transaction);
  return { user, identities };
}

async function unbindIdentity(models, user, identityId, transaction) {
  const identities = await loadUserIdentities(models, user.id, transaction);
  if (identities.length <= 1) {
    const err = new Error("CANNOT_UNBIND_LAST_IDENTITY");
    err.status = 400;
    throw err;
  }

  const identity = identities.find((item) => String(item.id) === String(identityId));
  if (!identity) {
    const err = new Error("IDENTITY_NOT_FOUND");
    err.status = 404;
    throw err;
  }

  await identity.destroy({ transaction });

  const updatePayload = {};
  if (identity.provider === PROVIDERS.PASSWORD) {
    await models.AuthCenterXhuntPasswordCredential.destroy({
      where: { userId: user.id },
      transaction,
    });
    updatePayload.accountName = null;
    updatePayload.accountNameLower = null;
  }
  if (identity.provider === PROVIDERS.GOOGLE) {
    updatePayload.primaryGoogleEmail = null;
  }
  if (identity.provider === PROVIDERS.EVM) {
    updatePayload.primaryEvmAddress = null;
  }
  if (identity.provider === PROVIDERS.TWITTER) {
    updatePayload.primaryTwitterId = null;
    updatePayload.xhuntUserId = null;
  }
  if (Object.keys(updatePayload).length > 0) {
    await user.update(updatePayload, { transaction });
  }

  const nextIdentities = await loadUserIdentities(models, user.id, transaction);
  return { user, identities: nextIdentities, removedProvider: identity.provider };
}

function buildWalletProfile(address) {
  const evm40 = extractEvm40Address(address);
  if (!evm40) {
    const err = new Error("INVALID_EVM_ADDRESS");
    err.status = 400;
    throw err;
  }
  const lower = normalizeEvmAddress(evm40);
  return {
    providerSubject: lower,
    providerSubjectLower: lower,
    username: lower,
    displayName: lower,
  };
}

module.exports = {
  PROVIDERS,
  findActiveClient,
  loadUserIdentities,
  registerWithPassword,
  loginWithPassword,
  upsertOAuthIdentityLogin,
  bindPasswordIdentity,
  bindOAuthIdentityToUser,
  unbindIdentity,
  buildWalletProfile,
  createAuditLog,
};
