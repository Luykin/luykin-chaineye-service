const { shortAddress } = require("./utils");

function pickIdentity(identities, provider) {
  return (identities || []).find((item) => item.provider === provider);
}

function resolvePublicName(user, identities) {
  const twitter = pickIdentity(identities, "twitter");
  if (twitter?.username) return twitter.username;
  if (twitter?.displayName) return twitter.displayName;

  if (user?.accountName) return user.accountName;

  const google = pickIdentity(identities, "google");
  if (google?.email) return google.email;

  const evm = pickIdentity(identities, "evm");
  if (evm?.providerSubjectLower) return shortAddress(evm.providerSubjectLower);

  return user?.id ? `user_${String(user.id).slice(0, 8)}` : "user";
}

function resolveAvatar(user, identities) {
  const twitter = pickIdentity(identities, "twitter");
  if (twitter?.avatar) return twitter.avatar;

  const google = pickIdentity(identities, "google");
  if (google?.avatar) return google.avatar;

  return user?.avatar || null;
}

function buildPublicUser(user, identities = []) {
  const providers = identities.map((item) => item.provider);
  const username = resolvePublicName(user, identities);
  const twitter = pickIdentity(identities, "twitter");
  const google = pickIdentity(identities, "google");
  const evm = pickIdentity(identities, "evm");

  return {
    id: user.id,
    username,
    displayName: username,
    avatar: resolveAvatar(user, identities),
    providers,
    xhuntUserId: user.xhuntUserId || null,
    isLinkedToXHuntUser: !!user.xhuntUserId,
    twitter: twitter
      ? {
          twitterId: twitter.providerSubject,
          username: twitter.username || null,
        }
      : null,
    google: google
      ? {
          email: google.email || null,
          emailVerified: !!google.emailVerified,
        }
      : null,
    evm: evm
      ? {
          address: evm.providerSubjectLower,
          shortAddress: shortAddress(evm.providerSubjectLower),
        }
      : null,
    accountName: user.accountName || null,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

module.exports = {
  resolvePublicName,
  resolveAvatar,
  buildPublicUser,
};
