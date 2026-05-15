const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
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
const { handleUpload } = require("@vercel/blob/client");

const router = express.Router();

// WebAuthn 配置
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "XHunt Admin";
const RP_ID = process.env.WEBAUTHN_RP_ID || (process.env.ADMIN_COOKIE_DOMAIN || "localhost");
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `https://${RP_ID}`;
const TEMP_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change-me";
const LINK_SECRET = process.env.SUPABASE_LINK_SECRET || "change-me-link";

const ADMIN_BLOB_PREFIX = (process.env.ADMIN_BLOB_PREFIX || "admin-images")
  .replace(/^\/+|\/+$/g, "") || "admin-images";
const ADMIN_BLOB_MAX_SIZE_MB = Math.max(1, Number(process.env.ADMIN_BLOB_MAX_SIZE_MB || 10));
const ADMIN_BLOB_MAX_SIZE_BYTES = Math.round(ADMIN_BLOB_MAX_SIZE_MB * 1024 * 1024);
const ADMIN_BLOB_ALLOWED_CONTENT_TYPES = (process.env.ADMIN_BLOB_ALLOWED_CONTENT_TYPES || "image/jpeg,image/png,image/webp,image/gif")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function parseRawCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) continue;
    out[key] = decodeURIComponent(valueParts.join("="));
  }
  return out;
}

async function getAdminFromRequest(req) {
  const cookieName = process.env.ADMIN_COOKIE_NAME || "xh_admin_session";
  const cookies = { ...parseRawCookies(req.headers.cookie || ""), ...(req.cookies || {}) };
  const token = cookies[cookieName];
  if (!token) return null;

  let session;
  try {
    session = jwt.verify(token, process.env.ADMIN_JWT_SECRET || "change-me");
  } catch (e) {
    return null;
  }

  const admin = await XhuntAdminManager.findByPk(session.id);
  if (!admin || !admin.isActive || !admin.canLogin) return null;
  return admin;
}

function adminCanUploadAssets(admin) {
  if (!admin) return false;
  if (admin.role === "super") return true;
  const permissions = Array.isArray(admin.permissions) ? admin.permissions : [];
  return permissions.includes("*") || permissions.includes("assets:upload");
}

function assertValidBlobPath(pathname) {
  const value = String(pathname || "").replace(/\\+/g, "/");
  if (!value || value.length > 220) {
    throw new Error("上传路径无效");
  }
  if (value.startsWith("/") || value.includes("..") || value.includes("//")) {
    throw new Error("上传路径不允许包含危险字符");
  }
  if (!value.startsWith(`${ADMIN_BLOB_PREFIX}/`)) {
    throw new Error(`上传路径必须位于 ${ADMIN_BLOB_PREFIX}/ 目录下`);
  }
  if (!/\.(jpe?g|png|webp|gif)$/i.test(value)) {
    throw new Error("仅支持 jpg、png、webp、gif 图片");
  }
  return value;
}

function parseClientPayload(payload) {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

// 登录页面由 React Admin 承载；保留 /admin/login 作为兼容入口。
router.get("/login", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const nextRaw = typeof req.query?.next === "string" ? req.query.next : "/overview";
  const next = nextRaw.startsWith("/admin-react/") ? nextRaw.replace("/admin-react", "") : nextRaw.startsWith("/") ? nextRaw : "/overview";
  return res.redirect(302, `/api/xhunt/stats#/login?next=${encodeURIComponent(next)}`);
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

// 提供给 React Admin 的当前管理员会话信息
router.get("/session", adminAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const admin = req.adminUser;
    return res.json({
      success: true,
      loggedIn: true,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
        receivesDailyReport: !!admin.receivesDailyReport,
        isActive: !!admin.isActive,
        canLogin: !!admin.canLogin,
        lastLoginAt: admin.lastLoginAt || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "获取会话信息失败" });
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
    res.json({ success: true, redirect: "/overview" });
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
    res.json({ success: true, redirect: "/overview", credCount });
  } catch (e) {
    console.error("[admin login] error:", e);
    res.status(500).json({ success: false, error: "登录失败" });
  }
});

// Vercel Blob 浏览器直传：后端只签发短期上传凭证，不接收图片文件
router.post("/uploads/blob", async (req, res) => {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ success: false, error: "缺少 BLOB_READ_WRITE_TOKEN 配置" });
    }

    const body = req.body || {};
    const isGenerateTokenEvent = body.type === "blob.generate-client-token";
    let currentAdmin = null;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        if (isGenerateTokenEvent) {
          const requestedWith = String(req.headers["x-requested-with"] || "").toLowerCase();
          if (requestedWith !== "xmlhttprequest") {
            throw new Error("非法上传请求");
          }
        }

        currentAdmin = await getAdminFromRequest(req);
        if (!currentAdmin) {
          throw new Error("请先登录后再上传图片");
        }
        if (!adminCanUploadAssets(currentAdmin)) {
          throw new Error("当前账号没有图片上传权限");
        }

        const safePathname = assertValidBlobPath(pathname);
        const payload = parseClientPayload(clientPayload);
        try {
          await XhuntAdminAuditLog.create({
            adminId: currentAdmin.id,
            email: currentAdmin.email,
            action: "blob-upload-token",
            route: "/admin/uploads/blob",
            method: "POST",
            ip: req.ip || "",
            userAgent: req.headers["user-agent"] || "",
            success: true,
            message: JSON.stringify({ pathname: safePathname, multipart: !!multipart, purpose: payload.purpose || null }),
          });
        } catch (e) {}

        return {
          allowedContentTypes: ADMIN_BLOB_ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: ADMIN_BLOB_MAX_SIZE_BYTES,
          addRandomSuffix: true,
          cacheControlMaxAge: 60 * 60 * 24 * 30,
          tokenPayload: JSON.stringify({
            adminId: currentAdmin.id,
            email: currentAdmin.email,
            pathname: safePathname,
            purpose: payload.purpose || "admin-image",
          }),
        };
      },
    });

    res.set("Cache-Control", "no-store");
    return res.status(200).json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成上传凭证失败";
    const status = /登录/.test(message) ? 401 : /权限/.test(message) ? 403 : /BLOB_READ_WRITE_TOKEN/.test(message) ? 500 : 400;
    try {
      await XhuntAdminAuditLog.create({
        adminId: null,
        email: null,
        action: "blob-upload-token",
        route: "/admin/uploads/blob",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: false,
        message,
      });
    } catch (_e) {}
    return res.status(status).json({ success: false, error: message });
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
    const creds = await XhuntAdminWebAuthnCredential.findAll({ attributes: ["adminId"] });
    const counts = {};
    for (const c of creds) { const aid = c.adminId; counts[aid] = (counts[aid] || 0) + 1; }
    res.json({ success: true, data: rows.map(r => ({ id: r.id, email: r.email, role: r.role, receivesDailyReport: r.receivesDailyReport, isActive: r.isActive, canLogin: r.canLogin, lastLoginAt: r.lastLoginAt, permissions: r.permissions, webauthnCount: counts[r.id] || 0 })) });
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
    const RESTRICTED = new Set(["admin-users", "admin-audit-logs", "admin:manage-permissions", "audit-logs:read"]);
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
    const RESTRICTED = new Set(["admin-users", "admin-audit-logs", "admin:manage-permissions", "audit-logs:read"]);
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
router.post("/supabase/link-token", adminAuth, requirePermission("supabase"), async (req, res) => {
  try {
    const admin = req.adminUser;
    // 需要已录入至少一个 WebAuthn 凭证
    const credCount = await XhuntAdminWebAuthnCredential.count({ where: { adminId: admin.id } });
    if (!credCount || credCount <= 0) {
      return res.status(403).json({ success: false, error: "需要先录入生物识别" });
    }
    const jti = randomUUID();
    const token = jwt.sign({ aid: admin.id, purpose: "supabase", jti }, LINK_SECRET, { expiresIn: 600 });
    const targetIP = process.env.SUPABASE_IP || "150.5.158.179";
    const url = `http://${targetIP}:8388/project/default?token=${encodeURIComponent(token)}`;
    return res.json({ success: true, token, url, ttl: 300 });
  } catch (e) {
    return res.status(500).json({ success: false, error: "生成票据失败" });
  }
});

// 校验一次性票据（用于 Nginx auth_request）
router.get("/supabase/verify-link", async (req, res) => {
  try {
    const token = req.headers["x-request-signature"];
    if (!token) {
      console.log("[supabase/verify-link] missing token");
      return res.status(401).json({ success: false });
    }
    let decoded;
    try {
      decoded = jwt.verify(String(token), LINK_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false });
    }
    if (decoded.purpose !== "supabase" || !decoded.jti) {
      return res.status(401).json({ success: false });
    }
    res.set("Cache-Control","no-store");
    return res.status(204).end();
  } catch (e) {
    console.log("[supabase/verify-link] error:", e?.message);
    return res.status(500).json({ success: false });
  }
});

// Logo 代理
router.get("/logo", async (req, res) => {
  try {
    const logoUrl = "https://oaewcvliegq6wyvp.public.blob.vercel-storage.com/xhunt_new.jpg";
    const response = await fetch(logoUrl);
    if (!response.ok) {
      return res.status(502).json({ success: false, error: "Failed to fetch logo" });
    }
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error("[logo proxy] error:", e?.message);
    res.status(500).json({ success: false, error: "Logo proxy failed" });
  }
});

// ========== Redis 管理路由 ==========
const redisRoutes = require("./redis");
router.use("/system/redis", redisRoutes);

module.exports = router;
