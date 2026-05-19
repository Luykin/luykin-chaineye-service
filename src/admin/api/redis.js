/**
 * Redis 管理 API
 * 提供 Key 的查询、修改、删除功能
 * 仅 super 管理员可访问
 */

const express = require("express");
const { adminAuth, requireRole } = require("../middleware/adminAuth");
const { getRedisClient } = require("../../lib/redisClient");
const { XhuntAdminAuditLog } = require("../../models/postgres-start");

const router = express.Router();

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

    const parseInfo = (info) => {
      const stats = {};
      String(info || "").split("\n").forEach((line) => {
        if (line.includes(":") && !line.startsWith("#")) {
          const [key, value] = line.split(":");
          if (key && value !== undefined) stats[key.trim()] = value.trim();
        }
      });
      return stats;
    };

    const memory = parseInfo(memoryInfo);
    const persistence = parseInfo(persistenceInfo);

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
