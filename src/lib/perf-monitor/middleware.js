// src/lib/perf-monitor/middleware.js

const eventsBuffer = [];
let flushInProgress = false;
let intervalId = null;
let droppedEventsCount = 0;
let lastDropLogAt = 0;

const PERF_QUEUE_KEY = "perf:events:queue";

function logDrop(reason, count, extra = {}) {
  droppedEventsCount += count;
  const now = Date.now();
  // 降级日志最多每 30 秒输出一次，避免监控异常时进一步放大日志 IO。
  if (now - lastDropLogAt < 30 * 1000) return;
  lastDropLogAt = now;
  console.warn("[perf-monitor] Dropped performance events", {
    reason,
    count,
    droppedEventsCount,
    ...extra,
  });
}

/**
 * Extracts a value from the request object based on a configuration array.
 * @param {object} req - The Express request object.
 * @param {Array} sourceConfig - e.g., ['headers', 'x-request-id'] or ['get', 'user-agent']
 * @returns {string | undefined} The extracted value.
 */
function extractValue(req, sourceConfig) {
  if (!Array.isArray(sourceConfig) || sourceConfig.length !== 2) {
    return undefined;
  }
  const [source, key] = sourceConfig;
  switch (source) {
    case "headers":
      return req.headers[key.toLowerCase()];
    case "query":
      return req.query[key];
    case "body":
      return req.body ? req.body[key] : undefined;
    case "get": // Special case for req.get()
      return req.get(key);
    default:
      return undefined;
  }
}

async function flushBuffers(redisClient, options = {}) {
  if (flushInProgress || eventsBuffer.length === 0) return;
  flushInProgress = true;
  const eventsToPush = eventsBuffer.splice(0, eventsBuffer.length);
  try {
    const maxQueueLength = Number(options.maxQueueLength) || 0;
    if (maxQueueLength > 0) {
      const queueLength = await redisClient.lLen(PERF_QUEUE_KEY);
      if (queueLength >= maxQueueLength) {
        logDrop("queue_over_limit_before_flush", eventsToPush.length, {
          queueLength,
          maxQueueLength,
        });
        return;
      }
    }

    // Corrected: Use camelCase lPush for redis v4 client
    await redisClient.lPush(
      PERF_QUEUE_KEY,
      eventsToPush.map(JSON.stringify)
    );

    if (eventsToPush.length > 0 && options.logSuccess === true) {
      console.log(
        `[perf-monitor-success] Flushed ${eventsToPush.length} events to Redis queue.`
      );
    }
  } catch (err) {
    console.warn("[perf-monitor] Buffer flush failed:", err);
    if (options.dropOnFlushError === false) {
      eventsBuffer.unshift(...eventsToPush);
    } else {
      logDrop("flush_failed", eventsToPush.length, {
        error: err?.message || String(err),
      });
    }
  } finally {
    flushInProgress = false;
  }
}

function createPerfMiddleware(config) {
  const {
    redisClient,
    flushThreshold,
    flushIntervalMs,
    maxBufferSize,
    trace: traceConfig,
    requestIdFrom,
    userIdFrom,
    collectDetailedInfo,
  } = config;

  if (intervalId) {
    clearInterval(intervalId);
  }

  intervalId = setInterval(() => flushBuffers(redisClient, config), flushIntervalMs);

  const gracefulShutdown = async () => {
    console.log("[perf-monitor] Flushing buffers before exit...");
    clearInterval(intervalId);
    await flushBuffers(redisClient, config);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const requestId = extractValue(req, requestIdFrom);
      if (!requestId) {
        return; // Request ID is mandatory
      }

      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const status = res.statusCode;

      const bufferLimit = Number(maxBufferSize) || 10000;
      if (eventsBuffer.length >= bufferLimit) {
        logDrop("memory_buffer_full", 1, {
          bufferSize: eventsBuffer.length,
          maxBufferSize: bufferLimit,
        });
        return;
      }

      const isError = status >= 400;
      const isSlow = durationMs > traceConfig.slowThresholdMs;
      const shouldTrace =
        isError || isSlow || Math.random() < traceConfig.sampleRate;

      const userId = extractValue(req, userIdFrom);

      // 记录 IP 链路（Cloudflare / Nginx / 多层反代场景下建议保留原始链路）
      const cfConnectingIp = req.headers["cf-connecting-ip"];
      const xRealIp = req.headers["x-real-ip"];
      const xForwardedForRaw = req.headers["x-forwarded-for"];
      const xForwardedForChain = String(xForwardedForRaw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Express 视角 IP（受 trust proxy 影响）
      const expressIp = req.ip;
      const ips = Array.isArray(req.ips) ? req.ips : [];

      // Socket 直连 IP（通常是上一跳：Nginx 或 CF）
      const remoteAddress = req.socket?.remoteAddress;

      // 选一个“最可能的真实客户端 IP”（优先 CF，然后 XFF 第一个，然后 X-Real-IP，然后 req.ip）
      const clientIp =
        cfConnectingIp ||
        xForwardedForChain[0] ||
        xRealIp ||
        expressIp ||
        remoteAddress;

      const event = {
        requestId,
        userId,
        ts: Date.now(),
        durationMs,
        status,
        method: req.method,
        path: req.originalUrl,
        // 基础事件只记录最可能的客户端 IP，避免事件体积暴增
        ip: clientIp,
        hasDetail: shouldTrace,
      };

      if (shouldTrace) {
        event.details = {};

        // 仅在错误请求时记录完整 IP 链路，避免详细事件体积增大
        if (isError) {
          event.details.ip = {
            clientIp,
            chain: xForwardedForChain,
            cfConnectingIp,
            xRealIp,
            xForwardedFor: xForwardedForRaw,
            expressIp,
            expressIps: ips,
            remoteAddress,
          };
        }

        for (const [key, sourceConfig] of Object.entries(collectDetailedInfo)) {
          const value = extractValue(req, sourceConfig);
          if (value !== undefined) {
            event.details[key] = value;
          }
        }
      }

      eventsBuffer.push(event);

      if (eventsBuffer.length >= flushThreshold) {
        flushBuffers(redisClient, config);
      }
    });

    next();
  };
}

module.exports = { createPerfMiddleware };
