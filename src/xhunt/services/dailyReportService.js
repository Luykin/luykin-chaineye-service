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

async function sendEmail(html, subject, toList) {
  const emailService = require("../services/emailService");
  
  // 发送给多个收件人
  const sendPromises = toList.map(to => 
    emailService.sendEmail(to, subject, html, html.replace(/<[^>]*>/g, ''))
  );
  
  await Promise.all(sendPromises);
  return { messageId: 'sent' };
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
