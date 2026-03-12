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
