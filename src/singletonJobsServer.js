require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const schedule = require("node-schedule");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const redis = require("redis");
const { exec, execFile } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// 将所有需要单实例运行的定时任务集中到这里启动（备份、日志清理等）
const pgBackupService = require("./services/pg-backup-service");
const {
  setupPostgres,
  pgInstance,
  VersionRequestStats,
  UrlRequestStats,
  XhuntAdminManager,
} = require("./models/postgres-start");
const { requestStatsManager } = require("./xhunt/middleware/security");
const { initPerfMonitor } = require("./lib/perf-monitor"); // 性能监控模块
const { recordGenericStat } = require("./xhunt/services/generic-stats-service");
const emailService = require("./services/emailService");

// 币安广场调度器（单例服务运行，避免 cluster 模式重复执行）
const initBinanceSquareModels = require("./binance-square/models");
const { BinanceSquareScheduler } = require("./binance-square/services/scheduler");
const { BinanceSquareTaskManager } = require("./binance-square/scraper/taskManager");

const HEALTH_CHECK_PM2_APPS = [
  { name: "luykin-chaineye-api", minOnline: 1 },
  { name: "luykin-chaineye-crawler", minOnline: 1 },
  { name: "luykin-chaineye-bot", minOnline: 1 },
  { name: "luykin-chaineye-jobs", minOnline: 1 },
];
const HEALTH_CHECK_5XX_COUNT_THRESHOLD = 20;
const HEALTH_CHECK_5XX_RATE_THRESHOLD = 0.05;
const HEALTH_CHECK_5XX_MIN_REQUESTS = 100;
const HEALTH_CHECK_QUEUE_THRESHOLD = 5000;
const HEALTH_CHECK_RESOURCE_THRESHOLD = 85;
let backendHealthCheckRunning = false;

// 初始化 Redis 客户端
const redisClient = redis.createClient({
  socket: {
    host: "127.0.0.1",
    port: 6379,
  },
});

// 清理 PM2 日志（删除 2 天前的日志文件），每 4 小时执行一次
async function cleanupPm2Logs() {
  try {
    const home = os.homedir();
    const logsDir = path.join(home, ".pm2", "logs");

    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const cutoff = now - twoDaysMs;

    const exists = fs.existsSync(logsDir);
    if (!exists) {
      console.log(`[PM2 Logs] 目录不存在: ${logsDir}`);
      return;
    }

    const entries = await fsp.readdir(logsDir, { withFileTypes: true });
    let deleted = 0;
    let scanned = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(logsDir, entry.name);
      try {
        const st = await fsp.stat(full);
        scanned++;
        if (st.mtimeMs < cutoff) {
          await fsp.unlink(full);
          deleted++;
        }
      } catch (e) {
        console.warn(`[PM2 Logs] 处理失败: ${full} -> ${e.message}`);
      }
    }

    console.log(
      `[PM2 Logs] 扫描 ${scanned} 个文件，删除 ${deleted} 个（阈值：2 天前）`
    );
  } catch (err) {
    console.error("[PM2 Logs] 清理出错:", err);
  }
}

// 获取5分钟时间窗口（向下取整到5分钟）
function get5MinWindow(date = new Date()) {
  const minutes = date.getUTCMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;
  const window = new Date(date);
  window.setUTCMinutes(roundedMinutes);
  window.setUTCSeconds(0);
  window.setUTCMilliseconds(0);
  return window.toISOString();
}

// 获取上一个5分钟窗口
function getPrev5MinWindow() {
  const now = new Date();
  const prev = new Date(now.getTime() - 5 * 60 * 1000);
  return get5MinWindow(prev);
}

// 统计数据定时任务：每5分钟执行一次（版本统计 + URL统计）
async function flushStats() {
  try {
    console.log(`
⏰ [${new Date().toISOString()}] 开始执行统计数据定时任务...`);

    // 1. 先flush所有内存中的数据（防止丢失）
    const status = requestStatsManager.getStatus();
    await Promise.all([
      Promise.all(
        Object.keys(status.versionMemoryCounter || {}).map((timeWindow) =>
          requestStatsManager.flushVersionMemoryToRedis(timeWindow, redisClient)
        )
      ),
      Promise.all(
        Object.keys(status.urlMemoryCounter || {}).map((timeWindow) =>
          requestStatsManager.flushUrlMemoryToRedis(timeWindow, redisClient)
        )
      ),
    ]);

    // 2. 获取上一个5分钟窗口
    const prevWindow = getPrev5MinWindow();

    // 3. 并行处理版本统计和URL统计
    await Promise.all([
      // 版本统计
      (async () => {
        try {
          const pattern = `version_stats:${prevWindow}:*`;
          const keys = await redisClient.keys(pattern);

          if (keys.length === 0) {
            console.log(`[版本统计] 上一个窗口 ${prevWindow} 没有数据，跳过`);
            return;
          }

          // 批量读取数据
          const statsData = [];
          for (const key of keys) {
            const count = await redisClient.get(key);
            if (count) {
              const version = key.split(":").pop();
              statsData.push({
                timeWindow: new Date(prevWindow),
                version: version,
                requestCount: parseInt(count, 10),
              });
            }
          }

          // 批量写入PostgreSQL（使用 upsert）
          if (statsData.length > 0) {
            for (const data of statsData) {
              await VersionRequestStats.upsert({
                timeWindow: data.timeWindow,
                version: data.version,
                requestCount: data.requestCount,
              });
            }
            console.log(
              `[版本统计] ✅ 已写入 ${statsData.length} 条记录到PostgreSQL (窗口: ${prevWindow})`
            );
          }

          // 删除Redis中上一个窗口的数据
          if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`[版本统计] ✅ 已删除Redis中的 ${keys.length} 个key`);
          }
        } catch (error) {
          console.error("[版本统计] ❌ 处理失败:", error);
        }
      })(),
      // URL统计
      (async () => {
        try {
          const pattern = `url_stats:${prevWindow}|*`;
          const keys = await redisClient.keys(pattern);

          if (keys.length === 0) {
            console.log(`[URL统计] 上一个窗口 ${prevWindow} 没有数据，跳过`);
            return;
          }

          // 批量读取数据
          const statsData = [];
          for (const key of keys) {
            const count = await redisClient.get(key);
            if (count) {
              // 从key中提取URL路径
              // key格式: url_stats:${timeWindow}|${urlPath}
              const separatorIndex = key.indexOf("|");
              if (separatorIndex > 0) {
                const urlPath = key.substring(separatorIndex + 1);
                statsData.push({
                  timeWindow: new Date(prevWindow),
                  urlPath: urlPath,
                  requestCount: parseInt(count, 10),
                });
              }
            }
          }

          // 批量写入PostgreSQL（使用 upsert）
          if (statsData.length > 0) {
            for (const data of statsData) {
              await UrlRequestStats.upsert({
                timeWindow: data.timeWindow,
                urlPath: data.urlPath,
                requestCount: data.requestCount,
              });
            }
            console.log(
              `[URL统计] ✅ 已写入 ${statsData.length} 条记录到PostgreSQL (窗口: ${prevWindow})`
            );
          }

          // 删除Redis中上一个窗口的数据
          if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`[URL统计] ✅ 已删除Redis中的 ${keys.length} 个key`);
          }
        } catch (error) {
          console.error("[URL统计] ❌ 处理失败:", error);
        }
      })(),
    ]);

    // 4. 清理超过20分钟的Redis数据
    const now = new Date();
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
    const oldWindows = [];
    for (let i = 0; i < 20; i++) {
      const oldWindow = new Date(
        twentyMinutesAgo.getTime() - i * 5 * 60 * 1000
      );
      oldWindows.push(get5MinWindow(oldWindow));
    }

    let versionCleanedCount = 0;
    let urlCleanedCount = 0;

    for (const oldWindow of oldWindows) {
      const versionPattern = `version_stats:${oldWindow}:*`;
      const urlPattern = `url_stats:${oldWindow}|*`;

      const [versionKeys, urlKeys] = await Promise.all([
        redisClient.keys(versionPattern),
        redisClient.keys(urlPattern),
      ]);

      if (versionKeys.length > 0) {
        await redisClient.del(versionKeys);
        versionCleanedCount += versionKeys.length;
      }
      if (urlKeys.length > 0) {
        await redisClient.del(urlKeys);
        urlCleanedCount += urlKeys.length;
      }
    }

    if (versionCleanedCount > 0 || urlCleanedCount > 0) {
      console.log(
        `[统计数据清理] ✅ 已清理 ${versionCleanedCount} 个版本统计Redis key，${urlCleanedCount} 个URL统计Redis key（超过20分钟）`
      );
    }
  } catch (error) {
    console.error("[统计数据] ❌ 定时任务执行失败:", error);
  }
}

// 清理7天前的PostgreSQL统计数据（版本统计 + URL统计，每天执行一次）
async function cleanupOldStats() {
  try {
    const { Op } = require("sequelize");
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    // 并行清理两个表
    const [versionDeletedCount, urlDeletedCount] = await Promise.all([
      VersionRequestStats.destroy({
        where: {
          timeWindow: {
            [Op.lt]: sevenDaysAgo,
          },
        },
      }),
      UrlRequestStats.destroy({
        where: {
          timeWindow: {
            [Op.lt]: sevenDaysAgo,
          },
        },
      }),
    ]);

    console.log(
      `[统计数据清理] ✅ 已清理 ${versionDeletedCount} 条版本统计数据，${urlDeletedCount} 条URL统计数据（7天前）`
    );
  } catch (error) {
    console.error("[统计数据清理] ❌ 清理旧数据失败:", error);
  }
}

function getMetricWindowTimestamps(rangeMinutes = 30, stepSeconds = 60) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const alignedNow = Math.floor(nowSeconds / stepSeconds) * stepSeconds;
  const totalSteps = Math.ceil((rangeMinutes * 60) / stepSeconds);
  const timestamps = [];
  for (let i = totalSteps - 1; i >= 0; i--) {
    timestamps.push(alignedNow - i * stepSeconds);
  }
  return timestamps;
}

async function safeRecordHealthCheckStat(action, payload = {}) {
  try {
    await recordGenericStat({
      type: "system_health_check",
      source: "singleton_jobs",
      action,
      subjectType: "backend",
      subjectName: "enterprise-admin",
      actorType: "system",
      actorName: "singletonJobsServer",
      ...payload,
    });
  } catch (error) {
    console.error("[HealthCheck] 记录通用统计失败:", error.message);
  }
}

async function getSuperAdminEmails() {
  const rows = await XhuntAdminManager.findAll({
    where: {
      role: "super",
      isActive: true,
      canLogin: true,
    },
    attributes: ["email"],
    raw: true,
  });
  return rows.map((row) => row.email).filter(Boolean);
}

async function checkPm2Health() {
  const result = {
    ok: true,
    summary: "pm2 进程正常",
    details: {},
    alerts: [],
  };

  try {
    const { stdout } = await execAsync("pm2 jlist", {
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 8,
    });
    const processes = JSON.parse(stdout || "[]");

    for (const app of HEALTH_CHECK_PM2_APPS) {
      const matched = processes.filter((proc) => proc.name === app.name);
      const onlineCount = matched.filter(
        (proc) => proc.pm2_env?.status === "online"
      ).length;
      const statuses = matched.map((proc) => proc.pm2_env?.status || "unknown");

      result.details[app.name] = {
        total: matched.length,
        online: onlineCount,
        statuses,
      };

      if (onlineCount < app.minOnline) {
        result.ok = false;
        result.alerts.push(
          `${app.name} 在线实例不足（online=${onlineCount}, expected>=${app.minOnline}）`
        );
      }

      if (matched.length === 0) {
        result.ok = false;
        result.alerts.push(`${app.name} 未出现在 pm2 列表中`);
      }

      if (matched.length > 1 && onlineCount < matched.length) {
        result.ok = false;
        result.alerts.push(
          `${app.name} 部分实例非 online（online=${onlineCount}, total=${matched.length}）`
        );
      }
    }

    if (result.alerts.length > 0) {
      result.summary = result.alerts.join("；");
    }
  } catch (error) {
    result.ok = false;
    result.summary = `pm2 检查失败: ${error.message}`;
    result.alerts.push(result.summary);
    result.details.error = error.message;
  }

  return result;
}

async function checkPerf5xxHealth() {
  const result = {
    ok: true,
    summary: "最近30分钟 5xx 正常",
    details: {
      requestCount: 0,
      count5xx: 0,
      rate5xx: 0,
    },
    alerts: [],
  };

  try {
    const windowTimestamps = getMetricWindowTimestamps(30, 60);
    const multi = redisClient.multi();
    windowTimestamps.forEach((ts) => multi.hGetAll(`perf:metrics:${ts}`));
    const rows = await multi.exec();

    let requestCount = 0;
    let count5xx = 0;
    rows.forEach((row) => {
      if (!row || Object.keys(row).length === 0) return;
      requestCount += parseInt(row.request_count || "0", 10) || 0;
      count5xx += parseInt(row["status_5xx"] || "0", 10) || 0;
    });

    const rate5xx = requestCount > 0 ? count5xx / requestCount : 0;
    result.details = {
      requestCount,
      count5xx,
      rate5xx,
    };

    const dangerousByCount = count5xx >= HEALTH_CHECK_5XX_COUNT_THRESHOLD;
    const dangerousByRate =
      requestCount >= HEALTH_CHECK_5XX_MIN_REQUESTS &&
      rate5xx >= HEALTH_CHECK_5XX_RATE_THRESHOLD;

    if (dangerousByCount || dangerousByRate) {
      result.ok = false;
      result.summary = `最近30分钟 5xx 偏高（count=${count5xx}, requestCount=${requestCount}, rate=${(
        rate5xx * 100
      ).toFixed(2)}%）`;
      result.alerts.push(result.summary);
    }
  } catch (error) {
    result.ok = false;
    result.summary = `5xx 统计检查失败: ${error.message}`;
    result.alerts.push(result.summary);
    result.details.error = error.message;
  }

  return result;
}

async function checkInfraHealth() {
  const result = {
    ok: true,
    summary: "基础依赖正常",
    details: {},
    alerts: [],
  };

  try {
    const [pong, queueLength] = await Promise.all([
      redisClient.ping(),
      redisClient.lLen("perf:events:queue"),
    ]);
    result.details.redisPing = pong;
    result.details.perfQueueLength = queueLength;

    if (pong !== "PONG") {
      result.ok = false;
      result.alerts.push(`Redis ping 异常: ${pong}`);
    }
    if (queueLength >= HEALTH_CHECK_QUEUE_THRESHOLD) {
      result.ok = false;
      result.alerts.push(`perf 队列积压过高: ${queueLength}`);
    }
  } catch (error) {
    result.ok = false;
    result.alerts.push(`Redis/队列检查失败: ${error.message}`);
    result.details.redisError = error.message;
  }

  try {
    const [rows] = await pgInstance.query("SELECT 1 AS ok");
    result.details.postgres = rows?.[0]?.ok === 1 ? "ok" : "unexpected";
    if (rows?.[0]?.ok !== 1) {
      result.ok = false;
      result.alerts.push("PostgreSQL 自检返回异常");
    }
  } catch (error) {
    result.ok = false;
    result.alerts.push(`PostgreSQL 自检失败: ${error.message}`);
    result.details.postgresError = error.message;
  }

  if (result.alerts.length > 0) {
    result.summary = result.alerts.join("；");
  }

  return result;
}

function snapshotCpuTimes() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function calcCpuUsagePercent(startTimes, endTimes) {
  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < startTimes.length; i++) {
    const start = startTimes[i];
    const end = endTimes[i];
    if (!start || !end) continue;

    const startTotal =
      start.user + start.nice + start.sys + start.idle + start.irq;
    const endTotal = end.user + end.nice + end.sys + end.idle + end.irq;

    idleDiff += end.idle - start.idle;
    totalDiff += endTotal - startTotal;
  }

  if (totalDiff <= 0) return 0;
  return Number((((totalDiff - idleDiff) / totalDiff) * 100).toFixed(2));
}

async function getCpuUsagePercent(sampleMs = 800) {
  const start = snapshotCpuTimes();
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const end = snapshotCpuTimes();
  return calcCpuUsagePercent(start, end);
}

async function getDiskUsagePercent(targetPath = ".") {
  const { stdout } = await execFileAsync("df", ["-Pk", targetPath], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("df 输出异常");
  }
  const columns = lines[lines.length - 1].split(/\s+/);
  const usePercentRaw = columns[4] || "";
  const percent = parseInt(usePercentRaw.replace("%", ""), 10);
  if (!Number.isFinite(percent)) {
    throw new Error(`无法解析磁盘使用率: ${usePercentRaw}`);
  }
  return percent;
}

async function checkSystemResourceHealth() {
  const result = {
    ok: true,
    summary: "系统资源正常",
    details: {},
    alerts: [],
  };

  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercent = Number(((usedMem / totalMem) * 100).toFixed(2));
    result.details.memoryPercent = memoryPercent;
    result.details.memoryUsedGb = Number(
      (usedMem / 1024 / 1024 / 1024).toFixed(2)
    );
    result.details.memoryTotalGb = Number(
      (totalMem / 1024 / 1024 / 1024).toFixed(2)
    );
    if (memoryPercent >= HEALTH_CHECK_RESOURCE_THRESHOLD) {
      result.ok = false;
      result.alerts.push(`内存使用率过高: ${memoryPercent}%`);
    }
  } catch (error) {
    result.ok = false;
    result.alerts.push(`内存检查失败: ${error.message}`);
    result.details.memoryError = error.message;
  }

  try {
    const cpuPercent = await getCpuUsagePercent();
    result.details.cpuPercent = cpuPercent;
    result.details.cpuCores = os.cpus().length;
    if (cpuPercent >= HEALTH_CHECK_RESOURCE_THRESHOLD) {
      result.ok = false;
      result.alerts.push(`CPU 使用率过高: ${cpuPercent}%`);
    }
  } catch (error) {
    result.ok = false;
    result.alerts.push(`CPU 检查失败: ${error.message}`);
    result.details.cpuError = error.message;
  }

  try {
    const diskPercent = await getDiskUsagePercent(".");
    result.details.diskPercent = diskPercent;
    if (diskPercent >= HEALTH_CHECK_RESOURCE_THRESHOLD) {
      result.ok = false;
      result.alerts.push(`磁盘使用率过高: ${diskPercent}%`);
    }
  } catch (error) {
    result.ok = false;
    result.alerts.push(`磁盘检查失败: ${error.message}`);
    result.details.diskError = error.message;
  }

  if (result.alerts.length > 0) {
    result.summary = result.alerts.join("；");
  }

  return result;
}

function buildHealthCheckEmailHtml(report) {
  const sections = report.checks
    .map((check) => {
      const detailJson = escapeHtml(JSON.stringify(check.details || {}, null, 2));
      return `
        <h3>${escapeHtml(check.name)}：${check.ok ? "正常" : "异常"}</h3>
        <p>${escapeHtml(check.summary)}</p>
        <pre style="background:#111827;color:#e5e7eb;padding:12px;border-radius:8px;overflow:auto;">${detailJson}</pre>
      `;
    })
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
      <h2>⚠️ XHunt 后端健康检查告警</h2>
      <p>时间：${new Date(report.checkedAt).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      })}</p>
      <p>本次检查发现风险项，已自动发出提醒。</p>
      ${sections}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function runBackendHealthCheck() {
  const checkedAt = new Date();
  if (backendHealthCheckRunning) {
    console.warn("[HealthCheck] 上一轮仍在执行，本轮跳过");
    await safeRecordHealthCheckStat("skip", {
      dimensions: { result: "skip_running" },
      meta: {
        checkedAt: checkedAt.toISOString(),
        reason: "previous_check_still_running",
      },
    });
    return;
  }

  backendHealthCheckRunning = true;
  try {
    const [pm2Health, perf5xxHealth, infraHealth] = await Promise.all([
      checkPm2Health(),
      checkPerf5xxHealth(),
      checkInfraHealth(),
    ]);
    const systemResourceHealth = await checkSystemResourceHealth();

    const checks = [
      { name: "PM2 进程", ...pm2Health },
      { name: "最近30分钟 5xx", ...perf5xxHealth },
      { name: "基础依赖", ...infraHealth },
      { name: "系统资源", ...systemResourceHealth },
    ];

    const dangerousChecks = checks.filter((item) => !item.ok);
    const metrics = {
      dangerCount: dangerousChecks.length,
      totalChecks: checks.length,
      count5xx: perf5xxHealth.details?.count5xx || 0,
      requestCount30m: perf5xxHealth.details?.requestCount || 0,
      perfQueueLength: infraHealth.details?.perfQueueLength || 0,
      cpuPercent: systemResourceHealth.details?.cpuPercent || 0,
      memoryPercent: systemResourceHealth.details?.memoryPercent || 0,
      diskPercent: systemResourceHealth.details?.diskPercent || 0,
    };
    const dimensions = {
      result: dangerousChecks.length > 0 ? "alert_sent" : "skipped",
    };
    const meta = {
      checkedAt: checkedAt.toISOString(),
      checks: checks.map((item) => ({
        name: item.name,
        ok: item.ok,
        summary: item.summary,
        details: item.details,
      })),
    };

    if (dangerousChecks.length === 0) {
      console.log("[HealthCheck] 本轮无风险，跳过邮件发送");
      await safeRecordHealthCheckStat("skip", { metrics, dimensions, meta });
      return;
    }

    const recipients = await getSuperAdminEmails();
    if (!recipients.length) {
      console.warn("[HealthCheck] 无超级管理员邮箱，无法发送告警");
      await safeRecordHealthCheckStat("skip", {
        metrics,
        dimensions: { ...dimensions, result: "skip_no_recipients" },
        meta: {
          ...meta,
          reason: "no_super_admin_recipients",
        },
      });
      return;
    }

    const html = buildHealthCheckEmailHtml({ checkedAt, checks });
    const subject = `⚠️ XHunt 后端健康检查告警 - ${checkedAt.toLocaleString(
      "zh-CN",
      { timeZone: "Asia/Shanghai" }
    )}`;

    const sendResults = await Promise.allSettled(
      recipients.map((to) =>
        emailService.sendEmail(to, subject, html, html.replace(/<[^>]*>/g, ""))
      )
    );
    const sentRecipients = recipients.filter(
      (_, index) => sendResults[index]?.status === "fulfilled"
    );
    const failedRecipients = recipients
      .map((to, index) => ({ to, result: sendResults[index] }))
      .filter((item) => item.result?.status === "rejected")
      .map((item) => ({
        to: item.to,
        error: item.result.reason?.message || String(item.result.reason),
      }));

    if (!sentRecipients.length) {
      console.error("[HealthCheck] 告警邮件全部发送失败", failedRecipients);
      await safeRecordHealthCheckStat("alert_send_failed", {
        metrics,
        dimensions: { ...dimensions, result: "alert_send_failed" },
        meta: {
          ...meta,
          recipients,
          failedRecipients,
        },
      });
      return;
    }

    console.log(
      `[HealthCheck] 已发送告警邮件给超级管理员: ${sentRecipients.join(", ")}`
    );
    await safeRecordHealthCheckStat("alert_sent", {
      metrics,
      dimensions,
      meta: {
        ...meta,
        recipients: sentRecipients,
        failedRecipients,
      },
    });
  } catch (error) {
    console.error("[HealthCheck] 执行失败:", error);
    await safeRecordHealthCheckStat("check_failed", {
      dimensions: { result: "failed" },
      meta: {
        checkedAt: checkedAt.toISOString(),
        error: error.message,
      },
    });
  } finally {
    backendHealthCheckRunning = false;
  }
}

(async () => {
  try {
    // 初始化PostgreSQL
    await setupPostgres();
    console.log("✅ PostgreSQL 连接成功");

    // 无需初始化独立收件人，直接使用 XhuntAdminManager.receivesDailyReport

    // 连接Redis
    await redisClient.connect();
    console.log("✅ Redis 连接成功");

    // --- Performance Monitor Initialization ---
    const { processor: perfProcessor } = initPerfMonitor({
      redisClient: redisClient,
      trace: {
        retentionHours: 30,
      },
      metrics: {
        timeWindowSecs: 60,
        retentionHours: 30,
      },
    });

    // Start the performance data processor job
    setInterval(() => {
      perfProcessor
        .run()
        .catch((err) =>
          console.error("[perf-monitor] Processor job failed:", err)
        );
    }, 5000); // Run every 5 seconds
    console.log(
      "✅ Performance monitor processor job started (every 2 seconds)."
    );
    // --- End Performance Monitor ---

    // 启动备份服务
    await pgBackupService.start();
    console.log("单例任务服务运行中...（备份/日志清理等）");

    // 立即执行一次清理
    cleanupPm2Logs();

    // 每 4 小时执行一次：0 */4 * * *
    schedule.scheduleJob("0 */4 * * *", cleanupPm2Logs);

    // 统计数据定时任务：每5分钟执行一次（版本统计 + URL统计）
    schedule.scheduleJob("*/5 * * * *", flushStats);

    // 清理旧数据：每天凌晨2点执行（UTC时间，对应北京时间10点）
    schedule.scheduleJob("0 2 * * *", cleanupOldStats);

    // 后端健康自检测：每 30 分钟执行一次，仅在发现风险时给超级管理员发送邮件
    schedule.scheduleJob("*/30 * * * *", runBackendHealthCheck);

    // ========== 币安广场调度器（单例服务运行） ==========
    let bsScheduler = null;
    const BS_SCHEDULER_KEY = "binance_square:scheduler:control";

    async function checkBinanceSquareScheduler() {
      try {
        // 1. 检查配置变更通知（来自 API 层的配置更新）
        const changedConfigKey = await redisClient.get("binance_square:config:changed");
        if (changedConfigKey && bsScheduler?.configService) {
          bsScheduler.configService.clearCache(changedConfigKey);
          console.log(`[BinanceSquare] 配置缓存已清除: ${changedConfigKey}`);
          await redisClient.del("binance_square:config:changed");
        }

        // 2. 检查启停控制
        const control = await redisClient.get(BS_SCHEDULER_KEY);

        if (control === "start") {
          if (!bsScheduler) {
            try {
              const bsDb = initBinanceSquareModels(pgInstance);
              const taskManager = new BinanceSquareTaskManager(bsDb);
              bsScheduler = new BinanceSquareScheduler(bsDb, taskManager);
              console.log("[BinanceSquare] 调度器实例已创建");
            } catch (e) {
              console.error("[BinanceSquare] ❌ 创建调度器失败:", e.message);
              return;
            }
          }
          if (!bsScheduler.isRunning) {
            await bsScheduler.start();
            console.log("[BinanceSquare] ✅ 调度器已启动");
          } else {
            // 健康检查：isRunning=true 但 Job 可能已丢失，检查下次触发时间
            const status = await bsScheduler.getStatus();
            const nextTime = status.nextIncrementalCrawl ? new Date(status.nextIncrementalCrawl) : null;
            const now = new Date();
            // 如果下次触发时间不存在或已过期超过5分钟，说明 Job 已丢失，需要重启
            if (!nextTime || (nextTime.getTime() < now.getTime() - 5 * 60 * 1000)) {
              console.warn(`[BinanceSquare] ⚠️ 调度器健康检查异常，下次增量触发时间=${nextTime?.toISOString() || '无'}，即将重启`);
              bsScheduler.stop();
              await bsScheduler.start();
              console.log("[BinanceSquare] ✅ 调度器已重启");
            }
          }
        } else if (control === "stop") {
          if (bsScheduler && bsScheduler.isRunning) {
            bsScheduler.stop();
            console.log("[BinanceSquare] ⏸️ 调度器已停止");
          }
        }
        // 其他值或无值：保持当前状态
      } catch (e) {
        console.error("[BinanceSquare] ❌ 调度器检查失败:", e.message);
      }
    }

    // 立即检查一次，然后每 30 秒轮询
    checkBinanceSquareScheduler();
    setInterval(checkBinanceSquareScheduler, 30000);
    console.log("✅ 币安广场调度器控制已启动（每30秒轮询 Redis）");

    // // RootDataPro 每日维护任务：每天 UTC 03:00
    // const taskManager = require("./rootdatapro/scraper/taskManager");
    // schedule.scheduleJob(
    //   { hour: 3, minute: 0, tz: "Etc/UTC" },
    //   async () => {
    //     try {
    //       console.log("[Daily Task] ⏰ 触发每日维护任务（UTC 03:00）");
    //       await taskManager.runDailyMaintenanceTask({ trigger: "scheduled" });
    //     } catch (e) {
    //       console.error("[Daily Task] 执行失败:", e);
    //     }
    //   }
    // );

    console.log(
      "✅ 统计数据定时任务已启动（每5分钟执行一次，处理版本统计和URL统计）"
    );
    console.log(
      "✅ 统计数据清理任务已启动（每天执行一次，清理版本统计和URL统计）"
    );
    // console.log(
    //   "✅ RootDataPro 每日维护任务已启动（每天 UTC 03:00 执行）"
    // );
  } catch (err) {
    console.error("单例任务进程启动失败:", err);
    process.exit(1);
  }
})();
