const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const path = require("path");
const { XhuntAdminManager, XhuntAdminAuditLog, XhuntAdminWebAuthnCredential } = require("../../models/postgres-start");
const jwt = require("jsonwebtoken");
const base64url = require("base64url");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { adminAuth, requireRole, requirePermission, setSessionCookie } = require("../middleware/adminAuth");
const { randomUUID } = require("crypto");

const router = express.Router();

// WebAuthn 配置
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "XHunt Admin";
const RP_ID = process.env.WEBAUTHN_RP_ID || (process.env.ADMIN_COOKIE_DOMAIN || "localhost");
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `https://${RP_ID}`;
const TEMP_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change-me";
const LINK_SECRET = process.env.SUPABASE_LINK_SECRET || "change-me-link";

// 登录页面（EJS）
router.get("/login", async (req, res) => {
  try {
    res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma','no-cache');
    res.set('Expires','0');
    res.set('Surrogate-Control','no-store');
    const app = req.app;
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "../../xhunt/views"));
    app.render(
      "admin-login",
      { error: null, v: Date.now() },
      (err, html) => {
        if (err) return res.status(500).send("Render error");
        res.send(html);
      }
    );
  } catch (e) {
    res.status(500).send("Render error");
  }
});

// 提供给 Nginx auth_request 的轻量会话校验端点：会话有效返回 204
router.get("/auth-check", adminAuth, async (req, res) => {
  try {
    res.set('Cache-Control','no-store');
    return res.status(204).end();
  } catch (e) {
    return res.status(500).json({ success: false });
  }
});

// ========== WebAuthn 注册（添加指纹/人脸） ==========
router.get("/webauthn/registration/options", async (req, res) => {
  try {
    res.set('Cache-Control','no-store');
    // 手动校验已登录会话（避免使用 adminAuth 导致 HTML 重定向）
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const rawCookie = req.cookies?.[cookieName] || (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.split('=')[1];
    if (!rawCookie) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    let session;
    try { session = jwt.verify(rawCookie, process.env.ADMIN_JWT_SECRET || 'change-me'); } catch (e) { return res.status(401).json({ success: false, error: 'UNAUTHORIZED' }); }
    const admin = await XhuntAdminManager.findByPk(session.id);
    if (!admin || !admin.isActive || !admin.canLogin) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const existing = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    const excludeCredentials = existing.map(c => ({ id: base64url.toBuffer(c.credentialId), type: "public-key" }));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: String(admin.id),
      userName: admin.email,
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred", authenticatorAttachment: "platform" },
    });
    const challengeKey = `webauthn:reg:challenge:${admin.id}`;
    await req.redisClient.set(challengeKey, options.challenge, { EX: 300 });
    res.json({ success: true, options });
  } catch (e) {
    res.status(500).json({ success: false, error: "生成注册参数失败" });
  }
});

router.post("/webauthn/registration/verify", express.json(), async (req, res) => {
  try {
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const rawCookie = req.cookies?.[cookieName] || (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.split('=')[1];
    if (!rawCookie) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    let session;
    try { session = jwt.verify(rawCookie, process.env.ADMIN_JWT_SECRET || 'change-me'); } catch (e) { return res.status(401).json({ success: false, error: 'UNAUTHORIZED' }); }
    const admin = await XhuntAdminManager.findByPk(session.id);
    if (!admin || !admin.isActive || !admin.canLogin) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const { attResp, nickname } = req.body || {};
    const challengeKey = `webauthn:reg:challenge:${admin.id}`;
    const expectedChallenge = await req.redisClient.get(challengeKey);
    if (!expectedChallenge) return res.status(400).json({ success: false, error: "注册超时" });

    const verification = await verifyRegistrationResponse({
      response: attResp,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    const { verified, registrationInfo } = verification;
    if (!verified || !registrationInfo) return res.status(400).json({ success: false, error: "注册校验失败" });

    const { credentialPublicKey, credentialID, counter, aaguid } = registrationInfo;
    const credentialIdB64 = base64url.encode(Buffer.from(credentialID));
    const publicKeyB64 = base64url.encode(Buffer.from(credentialPublicKey));

    await XhuntAdminWebAuthnCredential.create({
      adminId: admin.id,
      credentialId: credentialIdB64,
      publicKey: publicKeyB64,
      counter: counter || 0,
      aaguid: aaguid || null,
      deviceType: registrationInfo.credentialDeviceType || null,
      backedUp: registrationInfo.credentialBackedUp ?? null,
      nickname: (typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : null,
      lastUsedAt: null,
    });

    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "webauthn-register", route: "/admin/webauthn/registration/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    await req.redisClient.del(challengeKey);
    res.json({ success: true });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: null, email: null, action: "webauthn-register", route: "/admin/webauthn/registration/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
    res.status(500).json({ success: false, error: "注册失败" });
  }
});

// ========== WebAuthn 认证（登录二次验证） ==========
router.get("/webauthn/authentication/options", async (req, res) => {
  try {
    res.set('Cache-Control','no-store');
    const { tempToken } = req.query || {};
    if (!tempToken) return res.status(400).json({ success: false, error: "缺少参数" });
    let decoded;
    try { decoded = jwt.verify(String(tempToken), TEMP_JWT_SECRET); } catch (e) { return res.status(401).json({ success: false, error: "无效的会话" }); }
    if (decoded.step !== "pwd-ok") return res.status(401).json({ success: false, error: "无效的会话" });

    const admin = await XhuntAdminManager.findByPk(decoded.aid);
    if (!admin) return res.status(404).json({ success: false, error: "管理员不存在" });

    const creds = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    const allowCredentials = creds.map(c => ({ id: base64url.toBuffer(c.credentialId), type: "public-key" }));
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
      allowCredentials,
    });
    const challengeKey = `webauthn:auth:challenge:${admin.id}`;
    await req.redisClient.set(challengeKey, options.challenge, { EX: 300 });
    res.json({ success: true, options });
  } catch (e) {
    res.status(500).json({ success: false, error: "生成认证参数失败" });
  }
});

router.post("/webauthn/authentication/verify", express.json(), async (req, res) => {
  try {
    const { tempToken, assertion } = req.body || {};
    if (!tempToken || !assertion) return res.status(400).json({ success: false, error: "缺少参数" });
    let decoded;
    try { decoded = jwt.verify(String(tempToken), TEMP_JWT_SECRET); } catch (e) { return res.status(401).json({ success: false, error: "无效的会话" }); }
    if (decoded.step !== "pwd-ok") return res.status(401).json({ success: false, error: "无效的会话" });

    const admin = await XhuntAdminManager.findByPk(decoded.aid);
    if (!admin) return res.status(404).json({ success: false, error: "管理员不存在" });
    const challengeKey = `webauthn:auth:challenge:${admin.id}`;
    const expectedChallenge = await req.redisClient.get(challengeKey);
    if (!expectedChallenge) return res.status(400).json({ success: false, error: "认证超时" });

    const creds = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } });
    const credentialLookup = new Map(creds.map(c => [c.credentialId, c]));

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: (function () {
        // SimpleWebAuthn Browser 返回的 assertion.id 通常为 base64url 字符串，与我们存储的一致
        let credKey = null;
        if (typeof assertion?.id === 'string') {
          credKey = assertion.id;
        } else if (typeof assertion?.rawId === 'string') {
          // 兼容某些实现可能提供 rawId(base64url)
          credKey = assertion.rawId;
        }
        const found = credKey ? credentialLookup.get(credKey) : null;
        if (!found) return null;
        return {
          credentialID: base64url.toBuffer(found.credentialId),
          credentialPublicKey: base64url.toBuffer(found.publicKey),
          counter: Number(found.counter || 0),
        };
      })(),
    });

    const { verified, authenticationInfo } = verification;
    if (!verified || !authenticationInfo) return res.status(401).json({ success: false, error: "验证失败" });

    // 更新 counter 与 lastUsedAt
    const credId = base64url.encode(Buffer.from(authenticationInfo.credentialID));
    const row = await XhuntAdminWebAuthnCredential.findOne({ where: { credentialId: credId, adminId: admin.id } });
    if (row) {
      row.counter = Number(authenticationInfo.newCounter || authenticationInfo.counter || 0);
      row.lastUsedAt = new Date();
      await row.save();
    }

    await admin.update({ lastLoginAt: new Date() });
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email });
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "webauthn-auth", route: "/admin/webauthn/authentication/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    await req.redisClient.del(challengeKey);
    res.json({ success: true, redirect: "/api/xhunt/stats" });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: null, email: null, action: "webauthn-auth", route: "/admin/webauthn/authentication/verify", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
    res.status(500).json({ success: false, error: "验证失败" });
  }
});

// ========== 凭证管理 ==========
router.get("/webauthn/credentials", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const rows = await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id }, order: [["updatedAt", "DESC"]] });
    res.json({ success: true, credentials: rows.map(r => ({ id: r.id, nickname: r.nickname, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt })) });
  } catch (e) {
    res.status(500).json({ success: false, error: "获取失败" });
  }
});

router.delete("/webauthn/credentials/:id", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: "参数无效" });
    const row = await XhuntAdminWebAuthnCredential.findOne({ where: { id, adminId: admin.id } });
    if (!row) return res.status(404).json({ success: false, error: "未找到" });
    await row.destroy();
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "webauthn-delete", route: `/admin/webauthn/credentials/${id}`, method: "DELETE", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "删除失败" });
  }
});

// 发送管理员密码修改验证码（发送到当前登录管理员邮箱）
router.post("/password/send-code", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const email = admin.email;
    // 生成 6 位数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `admin:pwdreset:${email}`;
    // 存入 Redis，10 分钟有效
    await req.redisClient.set(key, code, { EX: 600 });

    // 使用邮件服务发送验证码
    const emailService = require("../../services/emailService");
    
    await emailService.sendEmail(
      email,
      "XHunt 管理员修改密码验证码",
      `<p>您的验证码是 <b>${code}</b>，10 分钟内有效。</p>`,
      `您的验证码是 ${code}，10 分钟内有效。`
    );

    

    try { 
      await XhuntAdminAuditLog.create({ 
        adminId: admin.id, 
        email, 
        action: "password-send-code", 
        route: "/admin/password/send-code", 
        method: "POST", 
        ip: req.ip || "", 
        userAgent: req.headers["user-agent"] || "", 
        success: true 
      }); 
    } catch (e) {}
    
    return res.json({ success: true });
  } catch (e) {
    // 检查是否是认证失败错误
    const isAuthError = e.message && (
      e.message.includes('535') || 
      e.message.includes('Authentication unsuccessful') ||
      e.message.includes('basic authentication is disabled')
    );

    console.error(`[admin/password/send-code] ❌ 发送验证码失败:`, {
      email: req.adminUser?.email,
      error: e.message,
      stack: e.stack,
      nodemailerError: e.responseCode ? `SMTP错误码: ${e.responseCode}, 响应: ${e.response}` : undefined,
      command: e.command,
      isAuthError: isAuthError
    });

    try { 
      await XhuntAdminAuditLog.create({ 
        adminId: req.adminUser?.id, 
        email: req.adminUser?.email, 
        action: "password-send-code", 
        route: "/admin/password/send-code", 
        method: "POST", 
        ip: req.ip || "", 
        userAgent: req.headers["user-agent"] || "", 
        success: false, 
        message: e.message 
      }); 
    } catch (_) {}

    // 如果是认证错误，提供更详细的错误信息
    if (isAuthError) {
      
      return res.status(500).json({ 
        success: false, 
        error: "邮件发送失败：Office 365 基本认证已被禁用",
        message: "Office 365 已完全禁用基本认证（SMTP AUTH）。解决方案：1) 联系管理员在 Azure Portal 启用 SMTP AUTH 2) 使用其他邮件服务（如 SendGrid、Gmail）3) 配置 OAuth2 认证。详细步骤请查看服务器日志。"
      });
    }

    res.status(500).json({ success: false, error: "发送失败" });
  }
});

// 使用验证码重置当前登录管理员密码
router.post("/password/reset", adminAuth, express.json(), async (req, res) => {
  try {
    const admin = req.adminUser;
    const email = admin.email;
    const { code, newPassword } = req.body || {};
    if (!code || !newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: "参数无效（密码至少8位）" });
    }
    const key = `admin:pwdreset:${email}`;
    const cached = await req.redisClient.get(key);
    if (!cached || cached !== code) {
      return res.status(400).json({ success: false, error: "验证码错误或已过期" });
    }
    const adminRow = await XhuntAdminManager.findByPk(admin.id);
    if (!adminRow) return res.status(404).json({ success: false, error: "管理员不存在" });
    const hash = await bcrypt.hash(newPassword, 10);
    adminRow.passwordHash = hash;
    await adminRow.save();
    await req.redisClient.del(key);
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email, action: "password-reset", route: "/admin/password/reset", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    res.json({ success: true });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser?.id, email: req.adminUser?.email, action: "password-reset", route: "/admin/password/reset", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
    res.status(500).json({ success: false, error: "重置失败" });
  }
});

// 登录提交
router.post("/login", express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, error: "缺少参数" });

    const admin = await XhuntAdminManager.findOne({ where: { email } });
    if (!admin) {
      return res.status(401).json({ success: false, error: "邮箱或密码错误" });
    }
    if (!admin.isActive || !admin.canLogin) {
      return res.status(423).json({ success: false, error: "账号已被锁定，请联系管理员" });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      try {
        const key = `admin:loginfail:${email}`;
        const count = await req.redisClient.incr(key);
        if (count === 1) {
          await req.redisClient.expire(key, 12 * 60 * 60);
        }
        if (count >= 6) {
          await admin.update({ canLogin: false });
          await req.redisClient.del(key);
          try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "account-lock", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: `failed attempts: ${count}` }); } catch (e) {}
          return res.status(423).json({ success: false, error: "账号已被锁定，请联系管理员" });
        }
      } catch (e) {}
      return res.status(401).json({ success: false, error: "邮箱或密码错误" });
    }

    // 判断是否存在 WebAuthn 凭证
    const credCount = await XhuntAdminWebAuthnCredential.count({ where: { adminId: admin.id } });

    try { const key = `admin:loginfail:${email}`; await req.redisClient.del(key); } catch (e) {}

    if (credCount > 0) {
      // 需要二次验证：签发一个临时 token（5 分钟有效），不下发会话
      const tempToken = jwt.sign({ aid: admin.id, email: admin.email, step: "pwd-ok" }, TEMP_JWT_SECRET, { expiresIn: 300 });
      try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "login-password-ok", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: `credCount=${credCount}` }); } catch (e) {}
      res.set('Cache-Control','no-store');
      res.type('application/json');
      return res.json({ success: true, needsWebAuthn: true, tempToken, credCount });
    }

    // 无凭证：直接登录
    await admin.update({ lastLoginAt: new Date() });
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "login", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: `credCount=${credCount}` }); } catch (e) {}
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email });
    res.set('Cache-Control','no-store');
    res.type('application/json');
    res.json({ success: true, redirect: "/api/xhunt/stats", credCount });
  } catch (e) {
    console.error("[admin login] error:", e);
    res.status(500).json({ success: false, error: "登录失败" });
  }
});

// 登出
router.post("/logout", adminAuth, async (req, res) => {
  try {
    try { const u = req.adminUser; if (u) { await XhuntAdminAuditLog.create({ adminId: u.id, email: u.email, action: "logout", route: "/admin/logout", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } } catch (e) {}
    const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
    const secure = (process.env.ADMIN_COOKIE_SECURE || "false").toLowerCase() === "true";
    const domain = process.env.ADMIN_COOKIE_DOMAIN || undefined;
    res.cookie(cookieName, "", { httpOnly: true, sameSite: "lax", secure, domain, expires: new Date(0), path: "/" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// 管理员列表（用于配置是否接收日报）
router.get("/users", adminAuth, async (req, res) => {
  try {
    const rows = await XhuntAdminManager.findAll({ attributes: ["id", "email", "role", "receivesDailyReport", "isActive", "canLogin", "lastLoginAt", "permissions"], order: [["id", "ASC"]] });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "加载失败" });
  }
});

// 新增管理员（需要 admin:manage-permissions）
router.post("/users", adminAuth, requirePermission("admin:manage-permissions"), express.json(), async (req, res) => {
  try {
    const { email, password, role = "admin", permissions } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, error: "邮箱无效" });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ success: false, error: "密码至少8位" });
    }
    if (role !== "admin" && role !== "super") {
      return res.status(400).json({ success: false, error: "角色无效" });
    }

    // 权限数组可选
    let perms = [];
    if (Array.isArray(permissions)) {
      perms = permissions.filter((p) => typeof p === "string").map((p) => p.trim()).filter((p) => p.length > 0);
    }

    // 仅 super 可分配 管理员列表/操作记录 相关权限
    const RESTRICTED = new Set(["admin-users", "admin-audit-logs", "daily-report:send", "admin:manage-permissions", "audit-logs:read"]);
    if (req.adminUser.role !== "super") {
      const containsRestricted = perms.some((p) => RESTRICTED.has(p));
      if (containsRestricted) {
        return res.status(403).json({ success: false, error: "仅 super 可配置管理员相关权限" });
      }
    }

    const exists = await XhuntAdminManager.findOne({ where: { email } });
    if (exists) {
      return res.status(409).json({ success: false, error: "邮箱已存在" });
    }

    const hash = await bcrypt.hash(password, 10);
    const row = await XhuntAdminManager.create({
      email,
      passwordHash: hash,
      role,
      isActive: true,
      canLogin: true,
      receivesDailyReport: true,
      permissions: perms,
    });

    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser.id, email: req.adminUser.email, action: "create-admin", route: "/admin/users", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: JSON.stringify({ id: row.id, email }) }); } catch (e) {}
    return res.json({ success: true, data: { id: row.id, email: row.email, role: row.role, permissions: row.permissions } });
  } catch (e) {
    return res.status(500).json({ success: false, error: "创建失败" });
  }
});

// 切换是否接收日报：super 可修改任意，admin 仅可修改自己
router.patch("/users/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { receivesDailyReport } = req.body || {};
    const target = await XhuntAdminManager.findByPk(id);
    if (!target) return res.status(404).json({ success: false, error: "未找到" });

    const role = req.adminUser.role;
    if (role !== "super" && req.adminUser.id !== target.id) {
      return res.status(403).json({ success: false, error: "权限不足" });
    }

    if (typeof receivesDailyReport === "boolean") target.receivesDailyReport = receivesDailyReport;
    await target.save();
    res.json({ success: true, data: { id: target.id, receivesDailyReport: target.receivesDailyReport } });
  } catch (e) {
    res.status(500).json({ success: false, error: "更新失败" });
  }
});

// 更新管理员权限清单（需要 admin:manage-permissions 权限）
router.patch("/users/:id/permissions", adminAuth, requirePermission("admin:manage-permissions"), express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, error: "permissions 必须是字符串数组" });
    }
    const sanitized = permissions
      .filter((p) => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // 仅 super 可分配 管理员列表/操作记录 相关权限
    const RESTRICTED = new Set(["admin-users", "admin-audit-logs", "daily-report:send", "admin:manage-permissions", "audit-logs:read"]);
    if (req.adminUser.role !== "super") {
      const containsRestricted = sanitized.some((p) => RESTRICTED.has(p));
      if (containsRestricted) {
        return res.status(403).json({ success: false, error: "仅 super 可配置管理员相关权限" });
      }
    }
    const target = await XhuntAdminManager.findByPk(id);
    if (!target) return res.status(404).json({ success: false, error: "未找到" });

    target.permissions = sanitized;
    await target.save();
    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser.id, email: req.adminUser.email, action: "update-permissions", route: `/admin/users/${id}/permissions`, method: "PATCH", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true, message: JSON.stringify(sanitized) }); } catch (e) {}

    res.json({ success: true, data: { id: target.id, permissions: target.permissions } });
  } catch (e) {
    res.status(500).json({ success: false, error: "更新失败" });
  }
});

// 生成一次性 Supabase 访问票据（后台已登录）
router.post("/supabase/link-token", adminAuth, async (req, res) => {
  try {
    const admin = req.adminUser;
    const jti = randomUUID();
    const token = jwt.sign({ aid: admin.id, purpose: "supabase", jti }, LINK_SECRET, { expiresIn: 60 });
    await req.redisClient.set(`supabase:link:jti:${jti}`, "1", { EX: 120 });
    const targetIP = process.env.SUPABASE_IP || "150.5.158.179";
    const url = `http://${targetIP}:8388/?token=${encodeURIComponent(token)}`;
    return res.json({ success: true, token, url, ttl: 60 });
  } catch (e) {
    return res.status(500).json({ success: false, error: "生成票据失败" });
  }
});

// 校验一次性票据（用于 Nginx auth_request）
router.get("/supabase/verify-link", async (req, res) => {
  try {
    const bearer = typeof req.headers["authorization"] === "string" ? req.headers["authorization"] : undefined;
    const bearerToken = bearer && bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7) : undefined;
    const headerToken = req.headers["x-auth-token"] || bearerToken;
    const { token: queryToken } = req.query || {};
    const token = queryToken || headerToken;
    console.log("[supabase/verify-link] incoming1111:", {
      ip: req.ip,
      ua: req.headers["user-agent"],
      hasToken: !!token,
      hasBearer: !!bearerToken,
      hasHeaderToken: !!headerToken,
      hasQueryToken: !!queryToken,
      queryKeys: Object.keys(req.query || {}),
      accept: req.headers["accept"],
      xhr: req.headers["x-requested-with"],
    });
    if (!token) {
      console.log("[supabase/verify-link] missing token1111");
      return res.status(401).json({ success: false });
    }
    let decoded;
    try {
      const brief = String(token).slice(0, 16) + "...";
      decoded = jwt.verify(String(token), LINK_SECRET);
      console.log("[supabase/verify-link] jwt ok:", { brief, aid: decoded?.aid, jti: decoded?.jti, purpose: decoded?.purpose });
    } catch (e) {
      console.log("[supabase/verify-link] jwt verify failed:", e?.message);
      return res.status(401).json({ success: false });
    }
    if (decoded.purpose !== "supabase" || !decoded.jti) {
      console.log("[supabase/verify-link] invalid payload fields:", { purpose: decoded?.purpose, jti: decoded?.jti });
      return res.status(401).json({ success: false });
    }
    const key = `supabase:link:jti:${decoded.jti}`;
    const exists = await req.redisClient.get(key);
    console.log("[supabase/verify-link] redis jti exists:", !!exists);
    if (!exists) {
      console.log("[supabase/verify-link] jti not found or already used:", key);
      return res.status(401).json({ success: false });
    }
    await req.redisClient.del(key);
    try { await XhuntAdminAuditLog.create({ adminId: decoded.aid || null, email: null, action: "supabase-link", route: "/admin/supabase/verify-link", method: "GET", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    res.set("Cache-Control","no-store");
    return res.status(204).end();
  } catch (e) {
    console.log("[supabase/verify-link] error:", e?.message);
    return res.status(500).json({ success: false });
  }
});

module.exports = router;
