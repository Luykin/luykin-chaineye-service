const path = require("path");
const ejs = require("ejs");
const { Op } = require("sequelize");
const { VersionRequestStats, UrlRequestStats, SecurityViolationLog, XhuntAdminManager } = require("../../models/postgres-start");
const { getFullStats } = require("./statsService");

function getUTCDateRangeForLastMinutes(minutes = 30) {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60 * 1000);
  return { start, end };
}

function getTodayChinaRangeUTC() {
  // 北京时间当天 00:00:00 - 23:59:59 对应的 UTC
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = beijing.getUTCFullYear();
  const m = beijing.getUTCMonth();
  const d = beijing.getUTCDate();
  const startBj = new Date(Date.UTC(y, m, d, 0, 0, 0));
  const endBj = new Date(Date.UTC(y, m, d, 23, 59, 59));
  // 转回 UTC 时间：实际上 startBj/endBj 本身就是 UTC 构造
  // 直接返回即可
  return { start: new Date(startBj.getTime() - 8 * 60 * 60 * 1000), end: new Date(endBj.getTime() - 8 * 60 * 60 * 1000) };
}

async function collectReportData(redisClient) {
  // 1. 核心大盘（与页面一致）
  const fullStats = await getFullStats(redisClient);

  // 2. 最近30分钟 版本/接口统计
  const { start, end } = getUTCDateRangeForLastMinutes(30);
  const recentVersion = await VersionRequestStats.findAll({
    where: { timeWindow: { [Op.gte]: start, [Op.lte]: end } },
    order: [["timeWindow", "ASC"]],
    raw: true,
  });
  const recentUrl = await UrlRequestStats.findAll({
    where: { timeWindow: { [Op.gte]: start, [Op.lte]: end } },
    order: [["timeWindow", "ASC"]],
    raw: true,
  });

  // 3. 安全拦截今日新增
  const { start: cStart, end: cEnd } = getTodayChinaRangeUTC();
  const todaySecurityCount = await SecurityViolationLog.count({
    where: { createdAt: { [Op.gte]: cStart, [Op.lte]: cEnd } },
  });

  return {
    fullStats,
    recentVersion,
    recentUrl,
    todaySecurityCount,
    generatedAt: new Date(),
  };
}

async function renderEmailHTML(data) {
  const templatePath = path.join(__dirname, "../views/emails/daily-report.ejs");
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      templatePath,
      {
        data,
      },
      { rmWhitespace: false },
      (err, html) => {
        if (err) return reject(err);
        resolve(html);
      }
    );
  });
}

function buildTransport() {
  const nodemailer = require("nodemailer");
  const user = process.env.OUTLOOK_USER;
  const pass = process.env.OUTLOOK_PASS;
  if (!user || !pass) {
    throw new Error("OUTLOOK_USER/OUTLOOK_PASS 未配置");
  }
  // 注意：Microsoft Outlook 已禁用基本认证，需要使用应用密码（App Password）
  // 生成应用密码：https://account.microsoft.com/security -> 高级安全选项 -> 应用密码
  const cleanPass = pass ? pass.replace(/\s+/g, '') : pass; // 移除所有空格
  
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false, // true for 465, false for other ports (587 uses STARTTLS)
    auth: { 
      user, 
      pass: cleanPass // 使用清理后的密码（移除空格）
    },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: false, // 重要：改为false提高成功率
      ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
    },
    requireTLS: true, // 要求使用 TLS
    connectionTimeout: 15000, // 稍微延长超时时间
    greetingTimeout: 10000,
    socketTimeout: 15000,
    debug: process.env.NODE_ENV === 'development', // 开发环境开启调试
    logger: process.env.NODE_ENV === 'development'
  });

  // 添加错误处理函数
  transporter.on('error', (error) => {
    console.error('[dailyReportService] SMTP传输器错误:', error);
  });

  transporter.on('token', (token) => {
    console.log('[dailyReportService] OAuth2令牌更新:', token);
  });

  return transporter;
}

async function sendEmail(html, subject, toList) {
  const transporter = buildTransport();
  const from = process.env.OUTLOOK_FROM || process.env.OUTLOOK_USER;
  const info = await transporter.sendMail({
    from,
    to: toList.join(","),
    subject,
    html,
  });
  return info;
}

async function sendDailyReport(redisClient, overrideRecipients) {
  // 收件人
  let recipients = overrideRecipients;
  if (!recipients || recipients.length === 0) {
    const rows = await XhuntAdminManager.findAll({
      where: { receivesDailyReport: true, isActive: true, canLogin: true },
      raw: true,
    });
    recipients = rows.map((r) => r.email);
  }
  if (!recipients || recipients.length === 0) {
    console.log("[DailyReport] 无启用的收件人，跳过发送");
    return { sent: false, reason: "no_recipients" };
  }

  // 采集数据
  const reportData = await collectReportData(redisClient);
  const html = await renderEmailHTML(reportData);

  // 主题：XHunt 每日数据报告 - YYYY-MM-DD
  const chinaTime = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  const subject = `XHunt 每日数据报告 - ${chinaTime}`;

  const info = await sendEmail(html, subject, recipients);
  console.log("[DailyReport] 发送完成:", info.messageId || info);
  return { sent: true, messageId: info.messageId || "ok", recipients };
}

module.exports = {
  collectReportData,
  sendDailyReport,
};
