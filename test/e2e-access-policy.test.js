const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Op } = require("sequelize");

const state = {
  records: new Map(),
  groups: { vip: [], internal_test: [] },
};

function record(values) {
  return {
    id: values.id || `access-${state.records.size + 1}`,
    twitterId: null,
    authCenterUserId: null,
    xhuntUserId: null,
    status: "active",
    ...values,
    async update(changes) {
      Object.assign(this, changes);
      if (this.status === "active") state.records.set(this.twitterHandle, this);
      else state.records.delete(this.twitterHandle);
      return this;
    },
    toJSON() {
      return { ...this, update: undefined, toJSON: undefined };
    },
  };
}

const EchohuntFeatureAccess = {
  findOne: async ({ where }) => {
    if (typeof where.twitterHandle === "string") return state.records.get(where.twitterHandle) || null;
    const candidates = where[Op.or] || [];
    for (const candidate of candidates) {
      if (candidate.twitterHandle && state.records.has(candidate.twitterHandle)) {
        return state.records.get(candidate.twitterHandle);
      }
    }
    return null;
  },
  findAll: async () => [...state.records.values()],
  create: async (values) => {
    const created = record(values);
    state.records.set(created.twitterHandle, created);
    return created;
  },
};

const postgresModule = path.resolve(__dirname, "../src/models/postgres-start.js");
require.cache[postgresModule] = {
  id: postgresModule,
  filename: postgresModule,
  loaded: true,
  exports: {
    pgInstance: { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) },
    AuthCenterXhuntIdentity: { findOne: async () => null },
    AuthCenterXhuntUser: {},
    EchohuntFeatureAccess,
    XhuntVipTestUser: {
      findAll: async ({ where }) => state.groups[where.listType] || [],
    },
  },
};
const {
  E2E_PUBLISH_FEATURE_KEY,
  GLOBAL_ACCESS_HANDLE,
  assertE2ePublishAccess,
  grantE2ePublishAccess,
  grantE2ePublishAccessGroup,
  normalizeTwitterHandle,
  setE2ePublishAccessMode,
} = require("../src/echohunt/e2e/services/e2eAccessService");
const {
  EVM_ADDRESS_PATTERN,
  MAX_DISTRIBUTION_RECIPIENTS,
} = require("../src/echohunt/e2e/services/e2eMoney");

test("E2E publish access uses the documented global feature key", () => {
  assert.equal(E2E_PUBLISH_FEATURE_KEY, "e2e-publish");
  assert.equal(normalizeTwitterHandle("https://x.com/Project_Name/status/123"), "project_name");
  assert.equal(normalizeTwitterHandle("@@Project_Name"), "project_name");
});

test("E2E distribution shares one address validator and recipient limit", () => {
  assert.equal(MAX_DISTRIBUTION_RECIPIENTS, 500);
  assert.equal(EVM_ADDRESS_PATTERN.test("0x1111111111111111111111111111111111111111"), true);
  assert.equal(EVM_ADDRESS_PATTERN.test("0x1234"), false);
});

test("all-users mode permits any user with an X identity without binding the global record", async () => {
  state.records.clear();
  await setE2ePublishAccessMode("all", 1);

  await assert.rejects(
    assertE2ePublishAccess({ user: { id: "auth-user-without-x" }, identities: [] }),
    (error) => error.code === "E2E_PUBLISH_FORBIDDEN"
  );

  const access = await assertE2ePublishAccess({
    user: { id: "auth-user-1", xhuntUserId: "xhunt-user-1" },
    identities: [{ provider: "twitter", providerSubject: "1001", username: "new_user" }],
  });

  assert.equal(access.twitterHandle, GLOBAL_ACCESS_HANDLE);
  assert.equal(state.records.get(GLOBAL_ACCESS_HANDLE).authCenterUserId, null);
});

test("turning all-users mode off restores individual access checks", async () => {
  state.records.clear();
  await setE2ePublishAccessMode("all", 1);
  await setE2ePublishAccessMode("allowlist", 1);
  const authCenter = {
    user: { id: "auth-user-2" },
    identities: [{ provider: "twitter", providerSubject: "1002", username: "allowed_user" }],
  };

  await assert.rejects(assertE2ePublishAccess(authCenter), (error) => error.code === "E2E_PUBLISH_FORBIDDEN");
  await grantE2ePublishAccess({ twitterHandle: "allowed_user", twitterId: "1002" }, 1);
  assert.equal((await assertE2ePublishAccess(authCenter)).twitterHandle, "allowed_user");
});

test("bulk grants VIP users idempotently", async () => {
  state.records.clear();
  state.groups.vip = [
    { id: 1, username: "vip_one", twitterId: "2001" },
    { id: 2, username: "vip_two", twitterId: "2002" },
  ];
  await grantE2ePublishAccess({ twitterHandle: "vip_one", twitterId: "2001" }, 1);

  const first = await grantE2ePublishAccessGroup("vip", 1);
  const second = await grantE2ePublishAccessGroup("vip", 1);

  assert.deepEqual(first, { source: "vip", total: 2, created: 1, existing: 1, failed: 0 });
  assert.deepEqual(second, { source: "vip", total: 2, created: 0, existing: 2, failed: 0 });
});
