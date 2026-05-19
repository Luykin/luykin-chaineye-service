/**
 * Redis 管理 API
 * 提供 Key 的查询、修改、删除功能
 * 仅 super 管理员可访问
 */

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { adminAuth, requireRole } = require("../middleware/adminAuth");
const { getRedisClient } = require("../../lib/redisClient");
const { XhuntAdminAuditLog } = require("../../models/postgres-start");

const router = express.Router();
const execFileAsync = promisify(execFile);

// 敏感 Key 前缀列表 - 操作时显示警告
const SENSITIVE_KEY_PREFIXES = [
  "admin:",
  "webauthn:",
  "jwt:",
  "session:",
  "password:",
  "secret:",
  "token:",
  "credentials:",
  "private:",
];

// 最大 Value 显示大小 (100KB)
const MAX_VALUE_SIZE = 100 * 1024;


const REDIS_CONFIG_CATALOG = [
  {
    key: "maxmemory",
    label: "内存上限",
    type: "text",
    options: ["512mb", "768mb", "1gb", "1536mb", "2gb", "0"],
    recommendedValue: "1gb",
    placeholder: "如 1gb / 1536mb / 0",
    risk: "medium",
    description: "限制 Redis 可使用的最大内存。达到上限后按淘汰策略处理，避免 Redis 内存过大导致 fork、持久化或系统内存压力。",
    recommendation: "建议设置为服务器可承受范围内的固定值。若 Redis 主要用于缓存/队列/统计，可先用 1gb 或 1536mb；0 表示不限制，不建议生产使用。",
  },
  {
    key: "maxmemory-policy",
    label: "内存淘汰策略",
    type: "select",
    options: ["allkeys-lru", "allkeys-lfu", "volatile-lru", "volatile-ttl", "noeviction"],
    recommendedValue: "allkeys-lru",
    risk: "high",
    description: "Redis 达到 maxmemory 后如何淘汰 key。该项直接影响业务缓存、队列和临时数据的保留策略。",
    recommendation: "若 Redis 主要是缓存和临时监控数据，推荐 allkeys-lru；若存在不允许被淘汰的持久业务 key，请谨慎选择 volatile-lru 或 noeviction。",
  },
  {
    key: "save",
    label: "RDB 快照规则",
    type: "text",
    options: ["", "900 1", "900 1 300 10", "3600 1 300 100 60 10000"],
    recommendedValue: "",
    placeholder: "空=关闭；如 900 1",
    risk: "high",
    description: "控制 RDB 快照触发频率。写入频繁时 BGSAVE 会 fork 子进程，可能带来明显 CPU/内存抖动。",
    recommendation: "如果 Redis 只做缓存、队列和统计，建议关闭（空字符串）。如果需要基本持久化，可用 900 1，避免频繁快照。",
  },
  {
    key: "appendonly",
    label: "AOF 持久化",
    type: "select",
    options: ["no", "yes"],
    recommendedValue: "no",
    risk: "high",
    description: "开启后 Redis 会记录写命令用于恢复数据，但会增加磁盘 IO，并可能触发 AOF rewrite。",
    recommendation: "如果 Redis 不是关键数据源，建议关闭；如果必须保留写入历史，请开启并配合 everysec。",
  },
  {
    key: "appendfsync",
    label: "AOF fsync 策略",
    type: "select",
    options: ["everysec", "no", "always"],
    recommendedValue: "everysec",
    risk: "medium",
    description: "控制 AOF 写盘频率。always 最安全但 IO 压力最大，everysec 是常见折中。",
    recommendation: "如果 AOF 开启，推荐 everysec；不要在高流量业务中使用 always。",
  },
  {
    key: "no-appendfsync-on-rewrite",
    label: "Rewrite 时暂停 fsync",
    type: "select",
    options: ["yes", "no"],
    recommendedValue: "yes",
    risk: "medium",
    description: "AOF rewrite 期间是否跳过 fsync，减少 rewrite 阶段的 IO 抖动。",
    recommendation: "追求业务稳定时建议 yes，可降低 AOF rewrite 时的延迟尖刺。",
  },
  {
    key: "auto-aof-rewrite-percentage",
    label: "AOF 自动重写比例",
    type: "number",
    recommendedValue: "200",
    risk: "low",
    description: "AOF 文件增长超过上次 rewrite 基准多少百分比后触发重写。值越大，rewrite 越不频繁。",
    recommendation: "建议 200，降低 rewrite 频率；默认值过低时写入高峰容易频繁 rewrite。",
  },
  {
    key: "auto-aof-rewrite-min-size",
    label: "AOF 重写最小体积",
    type: "text",
    recommendedValue: "512mb",
    placeholder: "如 512mb / 1gb",
    risk: "low",
    description: "AOF 文件小于该值时不自动 rewrite。",
    recommendation: "建议 512mb 或 1gb，避免文件较小时频繁重写。",
  },
  {
    key: "lazyfree-lazy-user-del",
    label: "DEL 异步释放",
    type: "select",
    options: ["yes", "no"],
    recommendedValue: "yes",
    risk: "low",
    description: "普通 DEL 是否尽量异步释放内存，降低删除大 key 对 Redis 主线程的阻塞。",
    recommendation: "建议开启。项目里监控队列和统计 key 可能较大，开启后更稳。",
  },
  {
    key: "lazyfree-lazy-eviction",
    label: "淘汰异步释放",
    type: "select",
    options: ["yes", "no"],
    recommendedValue: "yes",
    risk: "low",
    description: "内存淘汰 key 时是否异步释放内存。",
    recommendation: "建议开启，配合 maxmemory 使用，减少淘汰大 key 的阻塞。",
  },
  {
    key: "lazyfree-lazy-expire",
    label: "过期异步释放",
    type: "select",
    options: ["yes", "no"],
    recommendedValue: "yes",
    risk: "low",
    description: "key 过期时是否异步释放内存。",
    recommendation: "建议开启，适合大量 TTL 缓存和统计数据。",
  },
  {
    key: "slowlog-log-slower-than",
    label: "慢日志阈值(微秒)",
    type: "number",
    recommendedValue: "10000",
    risk: "low",
    description: "命令执行超过该耗时才进入 SLOWLOG。单位是微秒，10000 表示 10ms。",
    recommendation: "建议 10000，聚焦真正慢命令，避免慢日志自身过多。",
  },
  {
    key: "slowlog-max-len",
    label: "慢日志最大条数",
    type: "number",
    recommendedValue: "128",
    risk: "low",
    description: "Redis 内存中保留的慢日志条数。",
    recommendation: "建议 128 或 256，足够排查问题，也避免长期占用。",
  },
];

const REDIS_CONFIG_MAP = new Map(REDIS_CONFIG_CATALOG.map((item) => [item.key, item]));

const REDIS_SYSTEMD_SERVICE_CANDIDATES = [
  "redis-server.service",
  "redis.service",
  "valkey.service",
];

const REDIS_SYSTEMD_CONFIG_CATALOG = [
  {
    key: "CPUQuota",
    label: "CPU 硬上限",
    type: "text",
    options: ["50%", "70%", "100%", "150%", ""],
    recommendedValue: "70%",
    placeholder: "如 70% / 100% / 空",
    description: "限制 Redis 最多使用多少 CPU。100% 约等于 1 个完整 CPU 核心，70% 表示最多 0.7 核。",
    recommendation: "如果 Redis 抢业务 CPU，建议先用 70%；如果机器核心数多且 Redis 是关键缓存，可提高到 100%。",
  },
  {
    key: "CPUWeight",
    label: "CPU 权重",
    type: "number",
    options: ["10", "20", "50", "100", ""],
    recommendedValue: "20",
    placeholder: "1-10000；空=系统默认",
    description: "CPU 竞争时的相对权重，不是硬限制。默认通常是 100，值越低越让业务进程优先。",
    recommendation: "建议 20，让 Redis 在 CPU 竞争时降低优先级；不要设太低导致 Redis 响应明显变慢。",
  },
  {
    key: "Nice",
    label: "进程 Nice",
    type: "number",
    options: ["0", "5", "10", "15", ""],
    recommendedValue: "10",
    placeholder: "-20 到 19；越大优先级越低",
    description: "Linux 调度优先级。Nice 越大，CPU 调度优先级越低。",
    recommendation: "建议 10。它是温和降级，适合作为 CPUQuota 之外的第二层保护。",
  },
  {
    key: "IOSchedulingClass",
    label: "IO 调度类型",
    type: "select",
    options: ["best-effort", "idle", ""],
    recommendedValue: "best-effort",
    placeholder: "空=系统默认",
    description: "控制 Redis 磁盘 IO 调度等级，主要影响 RDB/AOF 或大文件 rewrite 时的 IO 竞争。",
    recommendation: "建议 best-effort 配合较低优先级；如果 Redis 只是缓存且持久化关闭，可保持默认也可以。",
  },
  {
    key: "IOSchedulingPriority",
    label: "IO 优先级",
    type: "number",
    options: ["4", "6", "7", ""],
    recommendedValue: "7",
    placeholder: "0-7；7 最低",
    description: "best-effort / realtime 下的 IO 优先级，数字越大优先级越低。",
    recommendation: "建议 7，让 Redis rewrite 或落盘 IO 不抢业务进程。",
  },
];

const REDIS_SYSTEMD_CONFIG_MAP = new Map(REDIS_SYSTEMD_CONFIG_CATALOG.map((item) => [item.key, item]));

const EXPENSIVE_COMMANDS = {
  keys: {
    severity: "danger",
    title: "发现 KEYS：可能阻塞 Redis 主线程",
    advice: "线上排查请使用 SCAN 分批扫描，避免 KEYS 在 key 多时把 Redis 打满。",
  },
  zrange: {
    severity: "warning",
    title: "ZSET 范围读取较多",
    advice: "检查排行榜、索引或性能监控 trace index，限制范围、分页或降低写入/读取频率。",
  },
  zrangebyscore: {
    severity: "warning",
    title: "ZSET 按分数范围读取较多",
    advice: "确认范围是否过大，必要时缩短统计窗口或增加分页上限。",
  },
  zadd: {
    severity: "warning",
    title: "ZSET 写入压力偏高",
    advice: "常见来源是时间序列索引、排行榜或监控索引；低优先级数据建议采样或丢弃。",
  },
  lrange: {
    severity: "warning",
    title: "List 范围读取较多",
    advice: "检查队列/日志读取是否一次取太多，优先用固定窗口读取并及时 trim。",
  },
  ltrim: {
    severity: "warning",
    title: "List 裁剪压力偏高",
    advice: "说明队列或缓冲区写入频繁；监控类队列应降低上限，写不过来直接丢弃。",
  },
  lpush: {
    severity: "warning",
    title: "List 入队压力偏高",
    advice: "检查 perf:events:queue 等队列是否积压；监控数据应业务优先，超过阈值直接 drop。",
  },
  rpush: {
    severity: "warning",
    title: "List 入队压力偏高",
    advice: "检查业务队列或监控缓冲是否持续增长，必要时降采样或限制队列长度。",
  },
  hgetall: {
    severity: "warning",
    title: "HGETALL 可能读取大 Hash",
    advice: "大 Hash 请改用 HSCAN 或只读取必要字段，避免一次性拉全量。",
  },
  smembers: {
    severity: "warning",
    title: "SMEMBERS 可能读取大 Set",
    advice: "大 Set 请改用 SSCAN 或分页读取，避免主线程长时间阻塞。",
  },
  del: {
    severity: "info",
    title: "DEL 删除压力",
    advice: "删除大 key 时优先使用 UNLINK，并开启 lazyfree 相关配置。",
  },
};

const KNOWN_QUEUE_KEYS = [
  { key: "perf:events:queue", label: "性能监控队列", warnAt: 1000, dangerAt: 5000 },
  { key: "rdt_crawl:queue:1", label: "RootData Project 队列", warnAt: 1000, dangerAt: 5000 },
  { key: "rdt_crawl:queue:2", label: "RootData Organization 队列", warnAt: 1000, dangerAt: 5000 },
  { key: "rdt_crawl:queue:3", label: "RootData Person 队列", warnAt: 1000, dangerAt: 5000 },
];

function parseRedisInfo(info) {
  const stats = {};
  String(info || "").split("\n").forEach((line) => {
    if (line.includes(":") && !line.startsWith("#")) {
      const separatorIndex = line.indexOf(":");
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key) stats[key] = value;
    }
  });
  return stats;
}

function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseCommandStats(info) {
  const stats = parseRedisInfo(info);
  return Object.entries(stats)
    .filter(([key]) => key.startsWith("cmdstat_"))
    .map(([key, value]) => {
      const command = key.replace(/^cmdstat_/, "");
      const fields = {};
      String(value || "").split(",").forEach((part) => {
        const [fieldKey, fieldValue] = part.split("=");
        if (fieldKey) fields[fieldKey] = fieldValue;
      });
      return {
        command,
        calls: parseNumber(fields.calls),
        usec: parseNumber(fields.usec),
        usecPerCall: parseNumber(fields.usec_per_call),
        rejectedCalls: parseNumber(fields.rejected_calls),
        failedCalls: parseNumber(fields.failed_calls),
      };
    })
    .sort((a, b) => b.usec - a.usec);
}

function sanitizeCommandArg(value) {
  const text = String(value ?? "");
  if (text.length <= 90) return text;
  return `${text.slice(0, 90)}…`;
}

function parseSlowlogEntry(entry) {
  if (!Array.isArray(entry)) return null;
  const [id, timestamp, durationUsec, args, clientAddr, clientName] = entry;
  const command = Array.isArray(args) ? args.map(sanitizeCommandArg) : [];
  const timestampNumber = Number(timestamp);
  const durationNumber = Number(durationUsec);
  return {
    id,
    timestamp: timestampNumber || null,
    time: timestampNumber ? new Date(timestampNumber * 1000).toISOString() : null,
    durationUsec: Number.isFinite(durationNumber) ? durationNumber : 0,
    durationMs: Number.isFinite(durationNumber) ? Number((durationNumber / 1000).toFixed(3)) : 0,
    commandName: String(command[0] || "").toLowerCase(),
    command: command.slice(0, 12).join(" "),
    argCount: command.length,
    clientAddr: clientAddr ? String(clientAddr) : "",
    clientName: clientName ? String(clientName) : "",
  };
}

function pickConfigValue(items, key) {
  const item = items.find((config) => config.key === key);
  return item ? String(item.value ?? "") : "";
}

function addFinding(findings, finding) {
  const id = finding.id || `${finding.severity}:${finding.title}`;
  if (findings.some((item) => item.id === id)) return;
  findings.push({ id, ...finding });
}

function buildDiagnosticsFindings({ commandStats, slowlog, runtime, queues, configItems }) {
  const findings = [];
  const topByTime = commandStats.slice(0, 8);
  const maxmemory = pickConfigValue(configItems, "maxmemory");
  const lazyDel = pickConfigValue(configItems, "lazyfree-lazy-user-del");
  const slowThreshold = parseNumber(pickConfigValue(configItems, "slowlog-log-slower-than"), 10000);

  if (!maxmemory || maxmemory === "0") {
    addFinding(findings, {
      id: "maxmemory-unlimited",
      severity: "warning",
      title: "maxmemory 未限制",
      detail: "Redis 内存不设上限时，数据增长会放大 fork、淘汰和系统内存压力。",
      advice: "建议按服务器容量设置固定上限，例如 512mb / 1gb / 1536mb，并配合 allkeys-lru。",
    });
  }

  if (runtime.rdbBgsaveInProgress || runtime.aofRewriteInProgress) {
    addFinding(findings, {
      id: "persistence-running",
      severity: "danger",
      title: "持久化任务正在运行",
      detail: "BGSAVE / AOF rewrite 会 fork 子进程，写入高峰时可能造成 CPU 与内存尖刺。",
      advice: "如果 Redis 主要是缓存/监控队列，建议关闭 RDB/AOF 或降低触发频率。",
    });
  }

  if (runtime.latestForkUsec && runtime.latestForkUsec > 200000) {
    addFinding(findings, {
      id: "fork-slow",
      severity: "warning",
      title: `最近 fork 耗时 ${Math.round(runtime.latestForkUsec / 1000)}ms`,
      detail: "fork 时间偏高通常和 Redis 内存体量、持久化或 AOF rewrite 有关。",
      advice: "降低 Redis 内存上限、关闭不必要持久化，并避免大 key。",
    });
  }

  queues.forEach((queue) => {
    if (queue.length >= queue.dangerAt) {
      addFinding(findings, {
        id: `queue-danger-${queue.key}`,
        severity: "danger",
        title: `${queue.label} 积压 ${queue.length} 条`,
        detail: `${queue.key} 已超过危险线，说明写入速度可能超过消费速度。`,
        advice: queue.key === "perf:events:queue" ? "性能监控是低优先级，建议降低采样、缩短队列并写不过来直接丢弃。" : "检查消费者是否停止、限速或任务是否异常增长。",
      });
    } else if (queue.length >= queue.warnAt) {
      addFinding(findings, {
        id: `queue-warning-${queue.key}`,
        severity: "warning",
        title: `${queue.label} 有积压`,
        detail: `${queue.key} 当前 ${queue.length} 条，已超过观察线。`,
        advice: "继续观察增长趋势；低优先级监控数据不要为了完整性影响业务。",
      });
    }
  });

  topByTime.forEach((stat) => {
    const rule = EXPENSIVE_COMMANDS[stat.command];
    if (!rule || stat.calls <= 0) return;
    addFinding(findings, {
      id: `command-${stat.command}`,
      severity: rule.severity,
      title: rule.title,
      detail: `${stat.command.toUpperCase()} 累计 ${stat.calls} 次，累计耗时 ${(stat.usec / 1000).toFixed(1)}ms，平均 ${stat.usecPerCall.toFixed(3)}µs/次。`,
      advice: rule.advice,
    });
  });

  slowlog.slice(0, 20).forEach((entry) => {
    const rule = EXPENSIVE_COMMANDS[entry.commandName];
    if (rule) {
      addFinding(findings, {
        id: `slowlog-${entry.commandName}`,
        severity: rule.severity === "info" ? "warning" : rule.severity,
        title: `慢日志命中 ${entry.commandName.toUpperCase()}`,
        detail: `最近慢命令耗时 ${entry.durationMs}ms：${entry.command}`,
        advice: rule.advice,
      });
    } else if (entry.durationUsec > Math.max(slowThreshold * 5, 50000)) {
      addFinding(findings, {
        id: `slowlog-heavy-${entry.commandName || entry.id}`,
        severity: "warning",
        title: `慢命令 ${entry.commandName ? entry.commandName.toUpperCase() : "UNKNOWN"}`,
        detail: `耗时 ${entry.durationMs}ms，已明显超过当前慢日志阈值。`,
        advice: "结合命令参数确认是否访问了大 key、大范围或高频热 key。",
      });
    }
  });

  if (lazyDel === "no" && commandStats.some((stat) => stat.command === "del" && stat.calls > 0)) {
    addFinding(findings, {
      id: "lazyfree-disabled",
      severity: "info",
      title: "DEL 异步释放未开启",
      detail: "删除大 key 时可能在 Redis 主线程释放内存，造成短暂卡顿。",
      advice: "建议开启 lazyfree-lazy-user-del，并在业务代码里优先使用 UNLINK。",
    });
  }

  if (!findings.length) {
    addFinding(findings, {
      id: "healthy",
      severity: "safe",
      title: "暂未发现明显 Redis 热点",
      detail: "当前慢日志、命令统计和已知队列没有明显异常。",
      advice: "CPU 飙升时立即刷新本页；慢日志只保留最近记录，建议保留 128-256 条。",
    });
  }

  const weight = { danger: 0, warning: 1, info: 2, safe: 3 };
  return findings.sort((a, b) => (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9)).slice(0, 12);
}

function normalizeRedisConfigValue(key, value) {
  if (value === undefined || value === null) return "";
  const str = String(value).trim();
  if (key === "save" && ["disabled", "off", "none", "空", "关闭"].includes(str.toLowerCase())) {
    return "";
  }
  return str;
}

function getConfigValue(configResult, key) {
  if (!configResult) return null;
  if (Object.prototype.hasOwnProperty.call(configResult, key)) {
    return configResult[key];
  }
  const lowerKey = key.toLowerCase();
  const foundKey = Object.keys(configResult).find((item) => item.toLowerCase() === lowerKey);
  return foundKey ? configResult[foundKey] : null;
}

async function getRedisConfigSnapshot(redis) {
  const configResult = {};

  // node-redis v4 的 CONFIG GET 接收单个 pattern；逐个查询更稳，避免不同 Redis/客户端版本兼容问题。
  for (const item of REDIS_CONFIG_CATALOG) {
    try {
      Object.assign(configResult, await redis.configGet(item.key));
    } catch (singleError) {
      configResult[item.key] = null;
    }
  }

  return REDIS_CONFIG_CATALOG.map((item) => ({
    ...item,
    value: getConfigValue(configResult, item.key),
    isRecommended: String(getConfigValue(configResult, item.key) ?? "") === String(item.recommendedValue),
  }));
}

function normalizeSystemdServiceName(serviceName) {
  const name = String(serviceName || "redis-server.service").trim();
  const normalized = name.endsWith(".service") ? name : `${name}.service`;
  if (!/^[-_.@a-zA-Z0-9]+\.service$/.test(normalized)) {
    throw new Error("systemd service 名称不合法");
  }
  return normalized;
}

async function runSystemctl(args) {
  const { stdout, stderr } = await execFileAsync("systemctl", args, {
    timeout: 5000,
    maxBuffer: 512 * 1024,
  });
  return { stdout: String(stdout || ""), stderr: String(stderr || "") };
}

function parseSystemctlShow(output) {
  const result = {};
  String(output || "").split("\n").forEach((line) => {
    const index = line.indexOf("=");
    if (index <= 0) return;
    result[line.slice(0, index)] = line.slice(index + 1);
  });
  return result;
}

function parseSystemdServiceSection(content) {
  const values = {};
  let inService = false;
  String(content || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (/^\[.+\]$/.test(trimmed)) {
      inService = trimmed.toLowerCase() === "[service]";
      return;
    }
    if (!inService) return;
    const index = trimmed.indexOf("=");
    if (index <= 0) return;
    const key = trimmed.slice(0, index);
    if (REDIS_SYSTEMD_CONFIG_MAP.has(key)) {
      values[key] = trimmed.slice(index + 1);
    }
  });
  return values;
}

function normalizeSystemdConfigValue(key, value) {
  const str = value === undefined || value === null ? "" : String(value).trim();
  if (!REDIS_SYSTEMD_CONFIG_MAP.has(key)) {
    throw new Error(`不支持的 systemd 配置项：${key}`);
  }
  if (str === "") return "";

  switch (key) {
    case "CPUQuota": {
      if (!/^\d+(\.\d+)?%$/.test(str)) throw new Error("CPUQuota 必须是百分比，例如 70%");
      const number = Number(str.slice(0, -1));
      if (!Number.isFinite(number) || number <= 0 || number > 400) {
        throw new Error("CPUQuota 建议设置在 1%-400% 之间");
      }
      return `${number}%`;
    }
    case "CPUWeight": {
      const number = Number(str);
      if (!Number.isInteger(number) || number < 1 || number > 10000) {
        throw new Error("CPUWeight 必须是 1-10000 的整数");
      }
      return String(number);
    }
    case "Nice": {
      const number = Number(str);
      if (!Number.isInteger(number) || number < -20 || number > 19) {
        throw new Error("Nice 必须是 -20 到 19 的整数");
      }
      return String(number);
    }
    case "IOSchedulingClass": {
      if (!["realtime", "best-effort", "idle"].includes(str)) {
        throw new Error("IOSchedulingClass 只能是 realtime / best-effort / idle");
      }
      return str;
    }
    case "IOSchedulingPriority": {
      const number = Number(str);
      if (!Number.isInteger(number) || number < 0 || number > 7) {
        throw new Error("IOSchedulingPriority 必须是 0-7 的整数");
      }
      return String(number);
    }
    default:
      return str;
  }
}

function buildSystemdOverrideContent(values) {
  const lines = [
    "# Managed by luykin-chaineye admin Redis management.",
    "# Empty values reset that systemd property to default.",
    "[Service]",
  ];
  REDIS_SYSTEMD_CONFIG_CATALOG.forEach((item) => {
    lines.push(`${item.key}=${values[item.key] ?? ""}`);
  });
  lines.push("");
  return lines.join("\n");
}

function getSystemdOverridePath(serviceName) {
  return path.join("/etc/systemd/system", `${serviceName}.d`, "override.conf");
}

async function detectRedisSystemdService() {
  for (const serviceName of REDIS_SYSTEMD_SERVICE_CANDIDATES) {
    try {
      const { stdout } = await runSystemctl(["show", serviceName, "--property=LoadState", "--no-pager"]);
      const parsed = parseSystemctlShow(stdout);
      if (parsed.LoadState === "loaded") return serviceName;
    } catch (err) {
      // 继续尝试下一个候选服务名
    }
  }
  return REDIS_SYSTEMD_SERVICE_CANDIDATES[0];
}

async function getRedisSystemdSnapshot(serviceNameInput) {
  const supported = process.platform === "linux";
  const serviceName = normalizeSystemdServiceName(serviceNameInput || (supported ? await detectRedisSystemdService() : REDIS_SYSTEMD_SERVICE_CANDIDATES[0]));
  const overridePath = getSystemdOverridePath(serviceName);

  if (!supported) {
    return {
      supported: false,
      reason: "当前运行环境不是 Linux/systemd；本地 macOS 只能看到配置界面，不能读取或写入服务器 systemd。",
      serviceName,
      serviceCandidates: REDIS_SYSTEMD_SERVICE_CANDIDATES,
      overridePath,
      items: REDIS_SYSTEMD_CONFIG_CATALOG.map((item) => ({ ...item, value: null, isRecommended: false })),
      effective: {},
      overrideContent: "",
      pendingRestart: false,
    };
  }

  let effective = {};
  let systemctlError = null;
  try {
    const { stdout } = await runSystemctl([
      "show",
      serviceName,
      "--property=LoadState,ActiveState,FragmentPath,DropInPaths,CPUQuotaPerSecUSec,CPUWeight,Nice,IOSchedulingClass,IOSchedulingPriority",
      "--no-pager",
    ]);
    effective = parseSystemctlShow(stdout);
  } catch (err) {
    systemctlError = err.message;
  }

  let overrideContent = "";
  let overrideValues = {};
  try {
    overrideContent = await fs.readFile(overridePath, "utf8");
    overrideValues = parseSystemdServiceSection(overrideContent);
  } catch (err) {
    overrideContent = "";
  }

  return {
    supported: true,
    serviceName,
    serviceCandidates: REDIS_SYSTEMD_SERVICE_CANDIDATES,
    overridePath,
    systemctlError,
    effective,
    overrideContent,
    pendingRestart: false,
    items: REDIS_SYSTEMD_CONFIG_CATALOG.map((item) => ({
      ...item,
      value: Object.prototype.hasOwnProperty.call(overrideValues, item.key) ? overrideValues[item.key] : "",
      isRecommended: String(overrideValues[item.key] ?? "") === String(item.recommendedValue),
    })),
  };
}

/**
 * 检查 Key 是否为敏感 Key
 */
function isSensitiveKey(key) {
  if (!key || typeof key !== "string") return false;
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEY_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
}

/**
 * 格式化 Value 用于显示
 */
function formatValue(value, type) {
  if (value === null || value === undefined) {
    return { raw: "", formatted: null, isJson: false };
  }

  let raw;
  try {
    if (typeof value === "string") {
      raw = value;
    } else {
      raw = JSON.stringify(value);
    }
  } catch {
    raw = String(value);
  }

  // 截断过大的值
  if (raw.length > MAX_VALUE_SIZE) {
    raw = raw.substring(0, MAX_VALUE_SIZE) + "\n... (内容已截断)";
  }

  // 尝试解析 JSON
  let formatted = value;
  let isJson = false;
  if (typeof raw === "string") {
    try {
      formatted = JSON.parse(raw);
      isJson = true;
    } catch {
      formatted = value;
    }
  }

  return { raw, formatted, isJson };
}

/**
 * 获取 Key 的详细信息
 */
async function getKeyInfo(redis, key) {
  const type = await redis.type(key);

  if (type === "none") {
    return null;
  }

  const ttl = await redis.ttl(key);
  let value;
  let length = 0;

  switch (type) {
    case "string":
      value = await redis.get(key);
      length = value ? value.length : 0;
      break;
    case "hash":
      value = await redis.hGetAll(key);
      length = Object.keys(value).length;
      break;
    case "list":
      length = await redis.lLen(key);
      value = await redis.lRange(key, 0, 99);
      break;
    case "set":
      value = await redis.sMembers(key);
      length = value.length;
      break;
    case "zset":
      length = await redis.zCard(key);
      value = await redis.zRangeWithScores(key, 0, 99);
      break;
    case "stream":
      length = await redis.xLen(key);
      value = `[Stream 类型，共 ${length} 个条目]`;
      break;
    default:
      value = `[不支持的数据类型: ${type}]`;
  }

  const formatted = formatValue(value, type);

  return {
    key,
    type,
    ttl: ttl > 0 ? ttl : null,
    length,
    size: formatted.raw ? Buffer.byteLength(formatted.raw, "utf8") : 0,
    value: formatted.raw,
    valueFormatted: formatted.formatted,
    isJson: formatted.isJson,
    isSensitive: isSensitiveKey(key),
  };
}


/**
 * 获取常用 Redis 运行配置
 * GET /api/admin/system/redis/config
 */
router.get("/config", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const redis = await getRedisClient();
    const [items, memoryInfo, persistenceInfo] = await Promise.all([
      getRedisConfigSnapshot(redis),
      redis.info("memory").catch(() => ""),
      redis.info("persistence").catch(() => ""),
    ]);

    const memory = parseRedisInfo(memoryInfo);
    const persistence = parseRedisInfo(persistenceInfo);

    res.json({
      success: true,
      data: {
        items,
        runtime: {
          usedMemoryHuman: memory.used_memory_human || null,
          usedMemoryPeakHuman: memory.used_memory_peak_human || null,
          maxmemoryHuman: memory.maxmemory_human || null,
          maxmemoryPolicy: memory.maxmemory_policy || null,
          rdbBgsaveInProgress: persistence.rdb_bgsave_in_progress === "1",
          aofRewriteInProgress: persistence.aof_rewrite_in_progress === "1",
          latestForkUsec: persistence.latest_fork_usec ? Number(persistence.latest_fork_usec) : null,
          aofEnabled: persistence.aof_enabled === "1",
        },
      },
    });
  } catch (err) {
    console.error("[redis admin] config error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 获取 Redis systemd 限流配置
 * GET /api/admin/system/redis/systemd?serviceName=redis-server.service
 */
router.get("/systemd", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const data = await getRedisSystemdSnapshot(req.query.serviceName);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[redis admin] systemd error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改 Redis systemd 限流配置
 * POST /api/admin/system/redis/systemd
 *
 * 注意：只写入 /etc/systemd/system/<service>.d/override.conf 并 daemon-reload；
 * 不自动重启 Redis，避免后台误操作影响业务。
 */
router.post("/systemd", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    if (process.platform !== "linux") {
      return res.status(400).json({
        success: false,
        error: "当前运行环境不是 Linux/systemd，无法写入 systemd 配置",
      });
    }

    const serviceName = normalizeSystemdServiceName(req.body?.serviceName);
    const inputValues = req.body?.values || {};
    const values = {};
    REDIS_SYSTEMD_CONFIG_CATALOG.forEach((item) => {
      values[item.key] = normalizeSystemdConfigValue(item.key, inputValues[item.key]);
    });

    const overridePath = getSystemdOverridePath(serviceName);
    const overrideDir = path.dirname(overridePath);
    const content = buildSystemdOverrideContent(values);

    await fs.mkdir(overrideDir, { recursive: true });
    await fs.writeFile(overridePath, content, "utf8");

    let daemonReload = null;
    try {
      daemonReload = await runSystemctl(["daemon-reload"]);
    } catch (reloadErr) {
      daemonReload = { error: reloadErr.message };
    }

    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action: "redis-systemd-update",
        route: "/admin/system/redis/systemd",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
        message: JSON.stringify({ serviceName, overridePath, values, daemonReload: daemonReload?.error || "ok" }),
      });
    } catch (auditErr) {
      console.error("[redis admin] audit log error:", auditErr);
    }

    const snapshot = await getRedisSystemdSnapshot(serviceName);
    res.json({
      success: true,
      message: daemonReload?.error ? "配置已写入，但 daemon-reload 失败" : "systemd 配置已写入",
      data: {
        ...snapshot,
        pendingRestart: true,
        daemonReload,
      },
    });
  } catch (err) {
    console.error("[redis admin] systemd update error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Redis 性能诊断
 * GET /api/admin/system/redis/diagnostics
 *
 * 只读取轻量 INFO / SLOWLOG / LLEN，不做 KEYS 或全量扫描，避免诊断本身影响业务。
 */
router.get("/diagnostics", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const redis = await getRedisClient();
    const slowlogLimit = Math.min(Math.max(parseInt(req.query.slowlogLimit, 10) || 30, 1), 128);

    const [
      configItems,
      serverInfo,
      clientsInfo,
      memoryInfo,
      statsInfo,
      cpuInfo,
      persistenceInfo,
      commandStatsInfo,
      slowlogRaw,
      slowlogLength,
      dbsize,
      queues,
    ] = await Promise.all([
      getRedisConfigSnapshot(redis),
      redis.info("server").catch(() => ""),
      redis.info("clients").catch(() => ""),
      redis.info("memory").catch(() => ""),
      redis.info("stats").catch(() => ""),
      redis.info("cpu").catch(() => ""),
      redis.info("persistence").catch(() => ""),
      redis.info("commandstats").catch(() => ""),
      redis.sendCommand(["SLOWLOG", "GET", String(slowlogLimit)]).catch(() => []),
      redis.sendCommand(["SLOWLOG", "LEN"]).catch(() => 0),
      redis.dbSize().catch(() => 0),
      Promise.all(KNOWN_QUEUE_KEYS.map(async (item) => {
        try {
          const length = await redis.lLen(item.key);
          return { ...item, length, exists: true };
        } catch (err) {
          return { ...item, length: 0, exists: false, error: err.message };
        }
      })),
    ]);

    const server = parseRedisInfo(serverInfo);
    const clients = parseRedisInfo(clientsInfo);
    const memory = parseRedisInfo(memoryInfo);
    const stats = parseRedisInfo(statsInfo);
    const cpu = parseRedisInfo(cpuInfo);
    const persistence = parseRedisInfo(persistenceInfo);
    const commandStats = parseCommandStats(commandStatsInfo);
    const slowlog = (Array.isArray(slowlogRaw) ? slowlogRaw : [])
      .map(parseSlowlogEntry)
      .filter(Boolean);

    const runtime = {
      version: server.redis_version || null,
      mode: server.redis_mode || null,
      uptimeInSeconds: parseNumber(server.uptime_in_seconds),
      connectedClients: parseNumber(clients.connected_clients),
      blockedClients: parseNumber(clients.blocked_clients),
      totalKeys: Number(dbsize) || 0,
      instantaneousOpsPerSec: parseNumber(stats.instantaneous_ops_per_sec),
      instantaneousInputKbps: parseNumber(stats.instantaneous_input_kbps),
      instantaneousOutputKbps: parseNumber(stats.instantaneous_output_kbps),
      totalCommandsProcessed: parseNumber(stats.total_commands_processed),
      rejectedConnections: parseNumber(stats.rejected_connections),
      expiredKeys: parseNumber(stats.expired_keys),
      evictedKeys: parseNumber(stats.evicted_keys),
      keyspaceHits: parseNumber(stats.keyspace_hits),
      keyspaceMisses: parseNumber(stats.keyspace_misses),
      usedMemoryHuman: memory.used_memory_human || null,
      usedMemoryPeakHuman: memory.used_memory_peak_human || null,
      maxmemoryHuman: memory.maxmemory_human || null,
      maxmemoryPolicy: memory.maxmemory_policy || null,
      memFragmentationRatio: memory.mem_fragmentation_ratio ? parseNumber(memory.mem_fragmentation_ratio) : null,
      usedCpuSys: cpu.used_cpu_sys ? parseNumber(cpu.used_cpu_sys) : null,
      usedCpuUser: cpu.used_cpu_user ? parseNumber(cpu.used_cpu_user) : null,
      usedCpuSysChildren: cpu.used_cpu_sys_children ? parseNumber(cpu.used_cpu_sys_children) : null,
      usedCpuUserChildren: cpu.used_cpu_user_children ? parseNumber(cpu.used_cpu_user_children) : null,
      rdbBgsaveInProgress: persistence.rdb_bgsave_in_progress === "1",
      aofRewriteInProgress: persistence.aof_rewrite_in_progress === "1",
      latestForkUsec: persistence.latest_fork_usec ? Number(persistence.latest_fork_usec) : null,
      aofEnabled: persistence.aof_enabled === "1",
    };

    const findings = buildDiagnosticsFindings({
      commandStats,
      slowlog,
      runtime,
      queues,
      configItems,
    });

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        runtime,
        slowlog: {
          total: Number(slowlogLength) || slowlog.length,
          entries: slowlog,
        },
        commandStats: commandStats.slice(0, 30),
        queues,
        findings,
        notes: [
          "诊断接口只读取 INFO、SLOWLOG、DBSIZE 和少量已知队列 LLEN，不做全量 key 扫描。",
          "INFO commandstats 是 Redis 启动以来累计值，适合看长期热点；CPU 飙升时建议刷新后结合慢日志一起看。",
        ],
      },
    });
  } catch (err) {
    console.error("[redis admin] diagnostics error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 清空 Redis 慢日志
 * POST /api/admin/system/redis/diagnostics/slowlog/reset
 */
router.post("/diagnostics/slowlog/reset", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const redis = await getRedisClient();
    const result = await redis.sendCommand(["SLOWLOG", "RESET"]);

    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action: "redis-slowlog-reset",
        route: "/admin/system/redis/diagnostics/slowlog/reset",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
        message: JSON.stringify({ result }),
      });
    } catch (auditErr) {
      console.error("[redis admin] audit log error:", auditErr);
    }

    res.json({ success: true, message: "慢日志已清空", data: { result } });
  } catch (err) {
    console.error("[redis admin] slowlog reset error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改 Redis 运行配置（仅允许常用白名单项）
 * POST /api/admin/system/redis/config
 */
router.post("/config", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key || typeof key !== "string") {
      return res.status(400).json({ success: false, error: "缺少配置 key" });
    }
    if (!REDIS_CONFIG_MAP.has(key)) {
      return res.status(400).json({ success: false, error: "该配置不在允许修改列表中" });
    }

    const redis = await getRedisClient();
    const normalizedValue = normalizeRedisConfigValue(key, value);
    const before = getConfigValue(await redis.configGet(key), key);

    await redis.configSet(key, normalizedValue);

    let rewriteResult = null;
    try {
      rewriteResult = await redis.configRewrite();
    } catch (rewriteErr) {
      rewriteResult = `CONFIG REWRITE 失败：${rewriteErr.message}`;
    }

    const after = getConfigValue(await redis.configGet(key), key);

    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action: "redis-config-update",
        route: "/admin/system/redis/config",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
        message: JSON.stringify({ key, before, after, rewriteResult }),
      });
    } catch (auditErr) {
      console.error("[redis admin] audit log error:", auditErr);
    }

    res.json({
      success: true,
      message: "配置已更新",
      data: { key, before, after, rewriteResult },
    });
  } catch (err) {
    console.error("[redis admin] config update error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 查询指定 Key
 * GET /api/admin/system/redis/query?key=xxx
 */
router.get("/query", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const { key } = req.query;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ success: false, error: "缺少 key 参数" });
    }

    const redis = await getRedisClient();
    const info = await getKeyInfo(redis, key);

    if (!info) {
      return res.json({ success: true, data: null, message: "Key 不存在" });
    }

    res.json({ success: true, data: info });
  } catch (err) {
    console.error("[redis admin] query error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 按前缀扫描 Keys
 * GET /api/admin/system/redis/keys?pattern=*&count=50
 */
router.get("/keys", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const { pattern = "*", count = "50" } = req.query;
    const limit = Math.min(parseInt(count, 10) || 50, 100);

    const redis = await getRedisClient();
    const keys = [];

    // 使用 SCAN 避免阻塞 Redis
    const iterator = redis.scanIterator({
      MATCH: pattern,
      COUNT: limit,
    });

    for await (const key of iterator) {
      keys.push(key);
      if (keys.length >= limit) break;
    }

    res.json({
      success: true,
      data: {
        keys,
        count: keys.length,
        pattern,
      },
    });
  } catch (err) {
    console.error("[redis admin] keys error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改 Redis 值（支持 string, hash, list, set, zset 类型）
 * POST /api/admin/system/redis/update
 */
router.post("/update", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { key, value, ttl, type: reqType } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ success: false, error: "缺少 key 参数" });
    }
    if (value === undefined) {
      return res.status(400).json({ success: false, error: "缺少 value 参数" });
    }

    const redis = await getRedisClient();

    // 获取当前 Key 类型
    const currentType = await redis.type(key);
    const targetType = reqType || currentType || 'string';

    // 获取旧值用于审计日志
    let oldValue = null;
    try {
      switch (currentType) {
        case 'string':
          oldValue = await redis.get(key);
          break;
        case 'hash':
          oldValue = await redis.hGetAll(key);
          break;
        case 'list':
          oldValue = await redis.lRange(key, 0, -1);
          break;
        case 'set':
          oldValue = await redis.sMembers(key);
          break;
        case 'zset':
          oldValue = await redis.zRangeWithScores(key, 0, -1);
          break;
      }
    } catch (e) {
      oldValue = null;
    }

    // 确保 value 是对象/数组（如果不是，尝试解析 JSON）
    let parsedValue = value;
    if (typeof value === 'string' && (targetType === 'hash' || targetType === 'list' || targetType === 'set' || targetType === 'zset')) {
      try {
        parsedValue = JSON.parse(value);
      } catch (e) {
        return res.status(400).json({ success: false, error: `${targetType} 类型需要有效的 JSON 格式` });
      }
    }

    // 根据类型设置新值
    if (targetType === 'hash') {
      // Hash 类型 - 使用 HSET，先删除旧值确保类型正确
      if (currentType !== 'hash' && currentType !== 'none') {
        await redis.del(key);
      }
      if (typeof parsedValue === 'object' && parsedValue !== null && !Array.isArray(parsedValue)) {
        const hashEntries = Object.entries(parsedValue).flat();
        if (hashEntries.length > 0) {
          await redis.hSet(key, hashEntries);
        } else {
          // 空对象，创建一个空的 hash
          await redis.hSet(key, '__placeholder__', '');
          await redis.hDel(key, '__placeholder__');
        }
      } else {
        return res.status(400).json({ success: false, error: 'Hash 类型需要 JSON 对象格式' });
      }
    } else if (targetType === 'list') {
      // List 类型 - 删除旧值后重新添加
      await redis.del(key);
      if (Array.isArray(parsedValue)) {
        if (parsedValue.length > 0) {
          await redis.rPush(key, parsedValue.map(String));
        }
      } else {
        return res.status(400).json({ success: false, error: 'List 类型需要 JSON 数组格式' });
      }
    } else if (targetType === 'set') {
      // Set 类型 - 删除旧值后重新添加
      await redis.del(key);
      if (Array.isArray(parsedValue)) {
        if (parsedValue.length > 0) {
          await redis.sAdd(key, parsedValue.map(String));
        }
      } else {
        return res.status(400).json({ success: false, error: 'Set 类型需要 JSON 数组格式' });
      }
    } else if (targetType === 'zset') {
      // ZSet 类型 - 删除旧值后重新添加
      await redis.del(key);
      if (Array.isArray(parsedValue)) {
        if (parsedValue.length > 0) {
          const zsetEntries = parsedValue.map(item => ({
            score: item.score || 0,
            value: String(item.value || item)
          }));
          await redis.zAdd(key, zsetEntries);
        }
      } else {
        return res.status(400).json({ success: false, error: 'ZSet 类型需要 JSON 数组格式' });
      }
    } else {
      // String 类型或其他 - 使用 SET
      const valueStr = String(value);
      if (ttl !== undefined && ttl !== null) {
        const ttlNum = parseInt(ttl, 10);
        if (ttlNum > 0) {
          await redis.set(key, valueStr, { EX: ttlNum });
        } else if (ttlNum === -1) {
          // -1 表示移除 TTL（永不过期）
          await redis.set(key, valueStr);
        } else {
          return res.status(400).json({ success: false, error: "TTL 必须大于 0 或等于 -1" });
        }
      } else {
        // TTL 为空，保持原有 TTL 不变
        // 先获取当前 TTL
        const currentTtl = await redis.ttl(key);
        await redis.set(key, valueStr);
        // 如果之前有 TTL 且未过期，恢复它
        if (currentTtl > 0) {
          await redis.expire(key, currentTtl);
        }
      }
    }

    // 设置 TTL（如果指定且不是 string 类型）
    if (ttl !== undefined && ttl !== null && targetType !== 'string') {
      const ttlNum = parseInt(ttl, 10);
      if (ttlNum > 0) {
        await redis.expire(key, ttlNum);
      }
    }

    // 记录审计日志
    try {
      const newValueStr = typeof value === 'object' ? JSON.stringify(value).substring(0, 500) : String(value).substring(0, 500);
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action: "redis-update",
        route: "/admin/system/redis/update",
        method: "POST",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
        message: JSON.stringify({
          key,
          type: targetType,
          oldValue: typeof oldValue === 'string' ? oldValue.substring(0, 500) : JSON.stringify(oldValue).substring(0, 500),
          newValue: newValueStr,
          ttl: ttl || null,
        }),
      });
    } catch (auditErr) {
      console.error("[redis admin] audit log error:", auditErr);
    }

    res.json({ success: true, message: "更新成功" });
  } catch (err) {
    console.error("[redis admin] update error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 删除指定 Key
 * DELETE /api/admin/system/redis/delete
 */
router.delete("/delete", adminAuth, requireRole("super"), express.json(), async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ success: false, error: "缺少 key 参数" });
    }

    const redis = await getRedisClient();

    // 获取旧值用于审计日志
    const type = await redis.type(key);
    let oldValue = null;
    if (type === "string") {
      oldValue = await redis.get(key);
    } else if (type !== "none") {
      oldValue = `[${type} 类型]`;
    }

    const deleted = await redis.del(key);

    if (deleted === 0) {
      return res.status(404).json({ success: false, error: "Key 不存在" });
    }

    // 记录审计日志
    try {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action: "redis-delete",
        route: "/admin/system/redis/delete",
        method: "DELETE",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        success: true,
        message: JSON.stringify({
          key,
          oldValue: oldValue ? oldValue.substring(0, 500) : null,
        }),
      });
    } catch (auditErr) {
      console.error("[redis admin] audit log error:", auditErr);
    }

    res.json({ success: true, message: "删除成功" });
  } catch (err) {
    console.error("[redis admin] delete error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 获取 Redis 服务器信息（简要）
 * GET /api/admin/system/redis/info
 */
router.get("/info", adminAuth, requireRole("super"), async (req, res) => {
  try {
    const redis = await getRedisClient();

    // 使用 info 命令获取基本信息
    const info = await redis.info();

    // 解析关键信息
    const lines = info.split("\n");
    const stats = {};

    for (const line of lines) {
      if (line.includes(":") && !line.startsWith("#")) {
        const [key, value] = line.split(":");
        if (key && value) {
          stats[key.trim()] = value.trim();
        }
      }
    }

    // 获取数据库 Key 数量
    const dbsize = await redis.dbSize();

    res.json({
      success: true,
      data: {
        version: stats.redis_version,
        mode: stats.redis_mode,
        os: stats.os,
        uptimeInSeconds: parseInt(stats.uptime_in_seconds, 10),
        connectedClients: parseInt(stats.connected_clients, 10),
        usedMemory: stats.used_memory_human,
        usedMemoryPeak: stats.used_memory_peak_human,
        totalKeys: dbsize,
        keyspaceHits: parseInt(stats.keyspace_hits, 10) || 0,
        keyspaceMisses: parseInt(stats.keyspace_misses, 10) || 0,
      },
    });
  } catch (err) {
    console.error("[redis admin] info error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
