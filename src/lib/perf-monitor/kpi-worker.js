// src/lib/perf-monitor/kpi-worker.js

const { workerData, parentPort } = require("worker_threads");
const Redis = require("ioredis");

// NOTE: The worker creates its own Redis connection.
// Ensure Redis connection options are available here if needed (e.g., via environment variables).
const redisClient = new Redis();

async function calculateKpis() {
  try {
    const {
      startTime,
      endTime,
      minCountForPercentile = 20,
      maxScan = 100000,
    } = workerData;

    if (!startTime || !endTime) {
      throw new Error("startTime and endTime are required");
    }

    const startTs = parseInt(startTime, 10);
    const endTs = parseInt(endTime, 10);

    const indexKeys = new Set();
    let currentTime = new Date(startTs);
    const endTimeDate = new Date(endTs);

    while (currentTime <= endTimeDate) {
      indexKeys.add(
        `perf:trace:index:${currentTime.toISOString().substring(0, 13)}`
      );
      currentTime.setHours(currentTime.getHours() + 1);
    }
    indexKeys.add(
      `perf:trace:index:${endTimeDate.toISOString().substring(0, 13)}`
    );

    const multi = redisClient.multi();
    Array.from(indexKeys).forEach((key) =>
      multi.zrangebyscore(key, startTs, endTs, "WITHSCORES")
    );
    const results = await multi.exec();

    let allTraces = [];
    // The format from ioredis for zrange with scores is [value1, score1, value2, score2, ...]
    for (const rangeResult of results) {
      if (!rangeResult || rangeResult[0]) {
        // Error check
        continue;
      }
      const flatResult = rangeResult[1] || [];
      for (let i = 0; i < flatResult.length; i += 2) {
        try {
          const value = flatResult[i];
          const score = parseInt(flatResult[i + 1], 10);
          const pointData = JSON.parse(value);
          allTraces.push({ ...pointData, ts: score });
        } catch (e) {
          // Ignore parse errors
        }
      }
      if (allTraces.length >= maxScan) {
        break;
      }
    }

    if (allTraces.length > maxScan) {
      allTraces = allTraces.slice(0, maxScan);
    }

    const totalCount = allTraces.length;
    if (totalCount === 0) {
      return {
        totalCount: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        count4xx: 0,
        count5xx: 0,
        rate4xx: 0,
        rate5xx: 0,
      };
    }

    let sumDuration = 0;
    let count4xx = 0;
    let count5xx = 0;
    const durations = [];

    for (const trace of allTraces) {
      sumDuration += trace.durationMs;
      durations.push(trace.durationMs);
      if (trace.status >= 400 && trace.status < 500) {
        count4xx++;
      } else if (trace.status >= 500) {
        count5xx++;
      }
    }

    durations.sort((a, b) => a - b);

    const avgMs = sumDuration / totalCount;
    let p50Ms = 0;
    let p95Ms = 0;

    if (totalCount >= minCountForPercentile) {
      const p50Index = Math.max(0, Math.ceil(totalCount * 0.5) - 1);
      const p95Index = Math.max(0, Math.ceil(totalCount * 0.95) - 1);
      p50Ms = durations[p50Index];
      p95Ms = durations[p95Index];
    }

    return {
      totalCount,
      avgMs,
      p50Ms,
      p95Ms,
      count4xx,
      count5xx,
      rate4xx: totalCount > 0 ? count4xx / totalCount : 0,
      rate5xx: totalCount > 0 ? count5xx / totalCount : 0,
    };
  } catch (err) {
    // Rethrow error to be caught by the main thread
    throw err;
  }
}

calculateKpis()
  .then((result) => {
    parentPort.postMessage({ success: true, data: result });
  })
  .catch((err) => {
    parentPort.postMessage({ success: false, error: err.message });
  })
  .finally(() => {
    redisClient.quit();
  });
