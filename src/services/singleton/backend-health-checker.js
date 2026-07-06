const os = require("os");
const { exec, execFile } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DEFAULT_PM2_APPS = [
  { name: "luykin-chaineye-api", minOnline: 1 },
  { name: "luykin-chaineye-crawler", minOnline: 1 },
  { name: "luykin-chaineye-bot", minOnline: 1 },
  { name: "luykin-chaineye-jobs", minOnline: 1 },
];

const DEFAULT_THRESHOLDS = {
  count5xx: 500,
  rate5xx: 0.05,
  minRequestsFor5xxRate: 100,
  perfQueueLength: 5000,
  resourcePercent: 85,
};

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function createBackendHealthChecker({
  redisClient,
  pgInstance,
  XhuntAdminManager,
  emailService,
  recordGenericStat,
  pm2Apps = DEFAULT_PM2_APPS,
  thresholds = DEFAULT_THRESHOLDS,
}) {
  let running = false;

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

      for (const app of pm2Apps) {
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

      const dangerousByCount = count5xx >= thresholds.count5xx;
      const dangerousByRate =
        requestCount >= thresholds.minRequestsFor5xxRate &&
        rate5xx >= thresholds.rate5xx;

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
      if (queueLength >= thresholds.perfQueueLength) {
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
      if (memoryPercent >= thresholds.resourcePercent) {
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
      if (cpuPercent >= thresholds.resourcePercent) {
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
      if (diskPercent >= thresholds.resourcePercent) {
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

  async function run() {
    const checkedAt = new Date();
    if (running) {
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

    running = true;
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
      running = false;
    }
  }

  return {
    run,
  };
}

module.exports = {
  createBackendHealthChecker,
};
