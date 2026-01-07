// src/lib/perf-monitor/middleware.js

const eventsBuffer = [];
let flushInProgress = false;
let intervalId = null;

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

async function flushBuffers(redisClient) {
  if (flushInProgress || eventsBuffer.length === 0) return;
  flushInProgress = true;
  const eventsToPush = eventsBuffer.splice(0, eventsBuffer.length);
  try {
    // Corrected: Use camelCase lPush for redis v4 client
    await redisClient.lPush(
      "perf:events:queue",
      eventsToPush.map(JSON.stringify)
    );

    // Add a success log
    if (eventsToPush.length > 0) {
      console.log(
        `[perf-monitor-success] Flushed ${eventsToPush.length} events to Redis queue.`
      );
    }
  } catch (err) {
    console.warn("[perf-monitor] Buffer flush failed:", err);
    eventsBuffer.unshift(...eventsToPush);
  } finally {
    flushInProgress = false;
  }
}

function createPerfMiddleware(config) {
  const {
    redisClient,
    flushThreshold,
    flushIntervalMs,
    trace: traceConfig,
    requestIdFrom,
    collectDetailedInfo,
  } = config;

  if (intervalId) {
    clearInterval(intervalId);
  }

  intervalId = setInterval(() => flushBuffers(redisClient), flushIntervalMs);

  const gracefulShutdown = async () => {
    console.log("[perf-monitor] Flushing buffers before exit...");
    clearInterval(intervalId);
    await flushBuffers(redisClient);
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

      const MAX_BUFFER_SIZE = 10000;
      if (eventsBuffer.length >= MAX_BUFFER_SIZE) {
        if (Math.random() < 0.01) {
          console.warn(
            "[perf-monitor] Buffer is full, dropping new performance data."
          );
        }
        return;
      }

      const isError = status >= 400;
      const isSlow = durationMs > traceConfig.slowThresholdMs;
      const shouldTrace =
        isError || isSlow || Math.random() < traceConfig.sampleRate;

      const event = {
        requestId,
        ts: Date.now(),
        durationMs,
        status,
        method: req.method,
        path: req.path,
        hasDetail: shouldTrace,
      };

      if (shouldTrace) {
        event.details = {};
        for (const [key, sourceConfig] of Object.entries(collectDetailedInfo)) {
          const value = extractValue(req, sourceConfig);
          if (value !== undefined) {
            event.details[key] = value;
          }
        }
      }

      eventsBuffer.push(event);

      if (eventsBuffer.length >= flushThreshold) {
        flushBuffers(redisClient);
      }
    });

    next();
  };
}

module.exports = { createPerfMiddleware };
