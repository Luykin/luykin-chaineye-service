const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const path = require("path");
const { XhuntAdminManager, XhuntAdminAuditLog } = require("../../models/postgres-start");
const { adminAuth, requireRole, setSessionCookie } = require("../middleware/adminAuth");

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

    // 懒加载 nodemailer
    let nodemailer;
    try { nodemailer = require("nodemailer"); } catch (_) { return res.status(500).json({ success: false, error: "缺少邮件依赖" }); }
    const user = process.env.OUTLOOK_USER;
    const pass = process.env.OUTLOOK_PASS;
    const from = process.env.OUTLOOK_FROM || `XHunt Server <${user}>`;
    if (!user || !pass) return res.status(500).json({ success: false, error: "未配置邮箱服务" });

    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: email,
      subject: "XHunt 管理员修改密码验证码",
      text: `您的验证码是 ${code}，10 分钟内有效。`,
      html: `<p>您的验证码是 <b>${code}</b>，10 分钟内有效。</p>`
    });

    try { await XhuntAdminAuditLog.create({ adminId: admin.id, email, action: "password-send-code", route: "/admin/password/send-code", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: true }); } catch (e) {}
    res.json({ success: true });
  } catch (e) {
    try { await XhuntAdminAuditLog.create({ adminId: req.adminUser?.id, email: req.adminUser?.email, action: "password-send-code", route: "/admin/password/send-code", method: "POST", ip: req.ip || "", userAgent: req.headers["user-agent"] || "", success: false, message: e.message }); } catch (_) {}
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
    if (!admin || !admin.isActive || !admin.canLogin) {
      return res.status(401).json({ success: false, error: "邮箱或密码错误" });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(401).json({ success: false, error: "邮箱或密码错误" });

    await admin.update({ lastLoginAt: new Date() });
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
    const rows = await XhuntAdminManager.findAll({ attributes: ["id", "email", "role", "receivesDailyReport", "isActive", "canLogin", "lastLoginAt"], order: [["id", "ASC"]] });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "加载失败" });
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

module.exports = router;
