const path = require("path");
const ejs = require("ejs");
const { Op } = require("sequelize");
const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
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

  // 4. 服务器状态采集（简版）
  const deviceStatus = await collectDeviceStatus(redisClient);

  return {
    fullStats,
    recentVersion,
    recentUrl,
    todaySecurityCount,
    deviceStatus,
    generatedAt: new Date(),
  };
}

async function collectDeviceStatus(redisClient) {
  const status = {
    timestamp: new Date(),
    system: {},
    cpu: {},
    memory: {},
    pm2: [],
    redis: { connected: false },
    disk: [],
  };

  // 系统信息
  status.system = {
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    uptime: os.uptime(),
  };

  // CPU（使用负载均值作为近似）
  const cpus = os.cpus() || [];
  const la = os.loadavg();
  status.cpu = {
    cores: cpus.length,
    loadAverage: `${(la[0] || 0).toFixed(2)} / ${(la[1] || 0).toFixed(2)} / ${(la[2] || 0).toFixed(2)}`,
  };

  // 内存
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(2) : "0";
  status.memory = {
    total: totalMem,
    used: usedMem,
    free: freeMem,
    usagePercent: memUsagePercent,
  };

  // PM2 状态
  try {
    const { stdout } = await execPromise("pm2 jlist");
    const pm2List = JSON.parse(stdout);
    status.pm2 = pm2List.map((app) => ({
      name: app.name,
      status: app.pm2_env?.status,
      cpu: app.monit?.cpu,
      memory: app.monit?.memory,
      restart: app.pm2_env?.restart_time,
      uptime: app.pm2_env?.pm_uptime,
    }));
  } catch (e) {
    status.pm2 = [];
  }

  // Redis 状态
  try {
    const info = await redisClient.info();
    const lines = info.split("\n");
    const map = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        map[k] = v;
      }
    }
    status.redis = {
      connected: true,
      memory: map["used_memory_human"] || map["used_memory"] || "-",
      maxMemory: map["maxmemory_human"] || map["maxmemory"] || "未设置",
      memoryUsagePercent: map["used_memory"] && map["maxmemory"] && parseInt(map["maxmemory"]) > 0
        ? ((parseInt(map["used_memory"]) / parseInt(map["maxmemory"])) * 100).toFixed(2) + "%"
        : "未设置限制",
      keys: map["db0"] ? (map["db0"].match(/keys=(\d+)/)?.[1] || "0") : "0",
      uptimeDays: map["uptime_in_days"] || "-",
      version: map["redis_version"] || "-",
    };
  } catch (e) {
    status.redis = { connected: false };
  }

  // 磁盘信息
  try {
    const { stdout } = await execPromise("df -h");
    const lines = stdout.split("\n").slice(1);
    for (const line of lines) {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length >= 6 && !parts[0].includes("tmpfs") && !parts[0].includes("devfs")) {
        status.disk.push({
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          avail: parts[3],
          usePercent: parts[4],
          mountedOn: parts[5],
        });
      }
    }
  } catch (e) {
    status.disk = [];
  }

  return status;
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
  const emailService = require("../../services/emailService");
  
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
