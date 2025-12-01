const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const path = require("path");
const { XhuntAdminManager, XhuntAdminAuditLog } = require("../../models/postgres-start");
const { adminAuth, requireRole, requirePermission, setSessionCookie } = require("../middleware/adminAuth");

const router = express.Router();

// 登录页面（EJS）
router.get("/login", async (req, res) => {
  try {
    const app = req.app;
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "../../xhunt/views"));
    app.render(
      "admin-login",
      { error: null },
      (err, html) => {
        if (err) return res.status(500).send("Render error");
        res.send(html);
      }
    );
  } catch (e) {
    res.status(500).send("Render error");
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

    console.log(`[admin/password/send-code] ✅ 验证码邮件发送成功: ${email}`);

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
      console.error(`[admin/password/send-code] ⚠️ Outlook 认证失败`);
      console.error(`[admin/password/send-code] 可能的原因和解决方案：`);
      console.error(`[admin/password/send-code] 1. 确认已使用应用密码（不是普通密码）`);
      console.error(`[admin/password/send-code] 2. 检查应用密码是否正确（去除所有空格）`);
      console.error(`[admin/password/send-code] 3. 确认账户已启用两步验证（应用密码需要）`);
      console.error(`[admin/password/send-code] 4. 如果使用 Office 365 企业账户，可能需要管理员启用基本认证`);
      console.error(`[admin/password/send-code] 5. 检查是否启用了"安全默认值"，可能需要禁用或使用 OAuth2`);
      console.error(`[admin/password/send-code] 6. 尝试重新生成应用密码：https://account.microsoft.com/security/app-passwords`);
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

    await admin.update({ lastLoginAt: new Date() });
    try { const key = `admin:loginfail:${email}`; await req.redisClient.del(key); } catch (e) {}
    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email: admin.email, action: "login", route: "/admin/login", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    setSessionCookie(res, { id: admin.id, role: admin.role, email: admin.email });

    res.json({ success: true, redirect: "/api/xhunt/stats" });
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

module.exports = router;
