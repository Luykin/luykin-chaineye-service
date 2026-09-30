// Isolated regression checks: no server, database, Redis, or external requests.
// Run: node --test scripts/test-admin-security.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const jwt = require("jsonwebtoken");

const root = path.resolve(__dirname, "..");
const secret = "isolated-admin-security-test-secret";
const noop = (_req, _res, next) => next();

function load(file, dependencies, env = { ADMIN_JWT_SECRET: secret }) {
  const context = { module: { exports: {} }, __dirname: path.dirname(path.join(root, file)), process: { env }, console: { log() {}, warn() {}, error() {} }, URL, Buffer };
  context.require = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (["crypto", "path", "util", "jsonwebtoken", "base64url"].includes(name)) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  return context.module.exports;
}

function fixture() {
  const rows = new Map();
  function add(id, role = "admin", permissions = []) {
    const row = { id, role, permissions, email: `admin${id}@example.invalid`, isActive: true, canLogin: true, passwordHash: "old-hash", failedLoginAttempts: 0,
      async save() {}, async update(values) { Object.assign(this, values); } };
    rows.set(id, row);
    return row;
  }
  add(1, "admin", ["admin:manage-permissions"]);
  add(2, "super");
  add(3);
  const store = new Map([["admin:session-version:1", "1"], ["admin:session-version:2", "1"], ["admin:session-version:3", "1"]]);
  const redis = { async get(key) { return store.get(key) ?? null; }, async set(key, value) { store.set(key, value); return "OK"; }, async del(...keys) { keys.forEach(key => store.delete(key)); }, async incr(key) { const n = Number(store.get(key) || 0) + 1; store.set(key, String(n)); return n; } };
  const credentials = [{ adminId: 1, rpId: "kb.cryptohunt.ai", credentialId: "dGVzdA" }];
  const models = {
    XhuntAdminManager: { async findByPk(id) { return rows.get(Number(id)); }, async findOne({ where }) { return [...rows.values()].find(row => row.email === where.email); }, async create(data) { const row = add(rows.size + 1); Object.assign(row, data); return row; } },
    XhuntAdminAuditLog: { async create() {} },
    XhuntAdminWebAuthnCredential: { async findAll({ where }) { return credentials.filter(row => row.adminId === where.adminId); } },
  };
  const auth = load("src/admin/middleware/adminAuth.js", { "../../models/postgres-start": models });
  const webauthn = load("src/admin/utils/webauthnConfig.js", {});
  const routes = new Map();
  const router = { use() {} };
  for (const method of ["get", "post", "patch", "delete"]) router[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers);
  load("src/admin/api/admin.js", {
    express: { Router: () => router, json: () => noop },
    bcryptjs: { async compare(password) { return password === "correct-password"; }, async hash() { return "new-hash"; } },
    sequelize: { Op: {} }, "../../models/postgres-start": models,
    child_process: { execFile() { throw new Error("No processes allowed"); } },
    "@simplewebauthn/server": { async generateRegistrationOptions() { return { challenge: "test-challenge" }; } },
    "../middleware/adminAuth": auth, "@vercel/blob/client": {}, "../../lib/llm": {},
    "../utils/webauthnConfig": webauthn, "./redis": {}, "../db-admin/router": {},
  });
  function token(id = 1, version = 1) { return jwt.sign({ id, sessionVersion: version }, secret, { expiresIn: 300 }); }
  function request(cookie = token(), extra = {}) {
    return { headers: { cookie: `xh_admin_session=${cookie}`, accept: "application/json", origin: "https://kb.cryptohunt.ai" }, redisClient: redis, body: {}, params: {}, query: {}, ...extra };
  }
  function response() {
    return { code: 200, cookies: [], status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set() { return this; }, type() { return this; }, cookie(...args) { this.cookies.push(args); return this; } };
  }
  async function call(method, url, req = request()) {
    const res = response();
    for (const handler of routes.get(`${method} ${url}`)) {
      let next = false;
      await handler(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  async function accepted(cookie, extra = {}) {
    let passed = false;
    await auth.adminAuth(request(cookie, extra), response(), () => { passed = true; });
    return passed;
  }
  return { auth, rows, store, redis, credentials, token, request, call, accepted };
}

test("missing or public default JWT secret fails at module load", () => {
  for (const value of [undefined, "", "   ", "change-me"]) {
    assert.throws(() => load("src/admin/middleware/adminAuth.js", { "../../models/postgres-start": {} }, { ADMIN_JWT_SECRET: value }), /ADMIN_JWT_SECRET/);
  }
});

test("MFA applies to the account across origins; accounts without credentials still work", async () => {
  const f = fixture();
  for (const origin of ["https://kb.cryptohunt.ai", "https://kb.xhunt.ai", "http://localhost"]) {
    const res = await f.call("post", "/login", f.request("", { headers: { origin }, body: { email: f.rows.get(1).email, password: "correct-password" } }));
    assert.equal(res.body.needsWebAuthn, true, origin);
    assert.equal(res.cookies.length, 0);
    assert.ok(res.body.tempToken);
  }
  const res = await f.call("post", "/login", f.request("", { body: { email: f.rows.get(3).email, password: "correct-password" } }));
  assert.equal(res.body.success, true);
  assert.equal(await f.accepted(res.cookies[0][1]), true);
});

test("non-super cannot create super or grant wildcard permissions", async () => {
  const f = fixture();
  for (const body of [{ role: "super", permissions: [] }, { role: "admin", permissions: ["*"] }]) {
    const res = await f.call("post", "/users", f.request(undefined, { body: { email: "new@example.invalid", password: "test-password", ...body } }));
    assert.equal(res.code, 403);
    assert.equal(f.rows.size, 3);
  }
  const res = await f.call("post", "/users", f.request(f.token(2), { body: { email: "new@example.invalid", password: "test-password", role: "super" } }));
  assert.equal(res.body.data.role, "super");
});

test("non-super cannot edit super permissions, reset super password, or grant wildcard", async () => {
  const f = fixture();
  for (const [method, url, id, body] of [
    ["patch", "/users/:id/permissions", 3, { permissions: ["*"] }],
    ["patch", "/users/:id/permissions", 2, { permissions: [] }],
    ["post", "/users/:id/password/reset-random", 2, {}],
  ]) {
    const res = await f.call(method, url, f.request(undefined, { params: { id }, body }));
    assert.equal(res.code, 403, url);
  }
});

test("revoked sessions cannot register credentials or obtain backup reauthentication options", async () => {
  const f = fixture();
  f.store.set("admin:session-version:1", "2");
  for (const [method, url] of [["get", "/webauthn/registration/options"], ["post", "/webauthn/registration/verify"], ["get", "/webauthn/backup-restore/options"]]) {
    assert.equal((await f.call(method, url)).code, 401, url);
  }
  const valid = await f.call("get", "/webauthn/registration/options", f.request(f.token(1, 2)));
  assert.equal(valid.body.success, true);
});

test("missing/unavailable Redis refuses sessions; recreated versions never revive old sessions", async () => {
  const f = fixture();
  const old = f.token();
  assert.equal(await f.accepted(old), true);
  f.store.delete("admin:session-version:1");
  assert.equal(await f.accepted(old), false);
  const version = await f.auth.bumpAdminSessionVersion(f.request(), 1);
  assert.equal(await f.accepted(old), false);
  assert.equal(await f.accepted(f.token(1, version)), true);
  assert.equal(await f.accepted(old, { redisClient: null }), false);
  f.redis.get = async () => { throw new Error("test outage"); };
  assert.equal(await f.accepted(old), false);
  f.redis.set = async () => { throw new Error("test outage"); };
  await assert.rejects(f.auth.bumpAdminSessionVersion(f.request(), 1));
});

test("both password reset paths invalidate previously issued sessions", async () => {
  for (const ownPassword of [true, false]) {
    const f = fixture();
    const old = f.token(3);
    f.store.set(`admin:pwdreset:${f.rows.get(3).email}`, "123456");
    const res = ownPassword
      ? await f.call("post", "/password/reset", f.request(old, { body: { code: "123456", newPassword: "new-password" } }))
      : await f.call("post", "/users/:id/password/reset-random", f.request(undefined, { params: { id: 3 } }));
    assert.equal(res.body.success, true);
    assert.equal(await f.accepted(old), false);
  }
});

test("performance log rendering preserves text and highlights without creating attacker HTML", () => {
  const ts = require("../admin-web/node_modules/typescript");
  const React = require("../admin-web/node_modules/react");
  const { renderToStaticMarkup } = require("../admin-web/node_modules/react-dom/server");
  const { JSDOM } = require("jsdom");
  const file = "admin-web/src/pages/PerfMonitorPage.tsx";
  const ast = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(s => ts.isFunctionDeclaration(s) && ["highlightText", "escapeHtml"].includes(s.name.text));
  const compiled = ts.transpileModule(declarations.map(s => s.getText(ast)).join("\n"), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
  const highlight = vm.runInNewContext(`${compiled};highlightText`, { React });
  // Exercise the actual rendering sink from the page, not just the helper.
  let sink;
  function visit(node) {
    const tag = ts.isJsxElement(node) ? node.openingElement.tagName : ts.isJsxSelfClosingElement(node) ? node.tagName : null;
    if (tag?.getText(ast) === "span" && node.getText(ast).includes("highlightText(line.content, detailRequestId)")) sink = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(sink);
  for (const query of ["audit", "", "<iframe", "[a].*"]) {
    const content = 'audit [a].* <iframe srcdoc="&lt;script&gt;parent.alert(1)&lt;/script&gt;"></iframe><img src=x onerror=alert(1)>';
    const render = ts.transpileModule(`const result = (${sink});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
    const element = vm.runInNewContext(`${render};result`, { React, highlightText: highlight, line: { content }, detailRequestId: query });
    const dom = new JSDOM(renderToStaticMarkup(element));
    assert.equal(dom.window.document.body.textContent, content);
    assert.equal(dom.window.document.querySelectorAll("iframe,img,script").length, 0);
    if (query) assert.equal(dom.window.document.querySelector("mark").textContent, query);
    dom.window.close();
  }
});
