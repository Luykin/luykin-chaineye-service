// src/lib/perf-monitor/errors-worker.js

const { workerData, parentPort } = require("worker_threads");

async function run() {
  const { redisConn, startTs, endTs, maxScan = 100000, indexKeys } = workerData;

  // Lazily require to avoid loading in main thread
  const redis = require("redis");

  const client = redis.createClient(redisConn);

  try {
    await client.connect();

    // Fetch in chunks to reduce peak memory and avoid huge multi payloads
    const chunkSize = 6; // hours per batch
    const allErrors = [];

    const keys = Array.isArray(indexKeys) ? indexKeys : [];

    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const multi = client.multi();
      chunk.forEach((key) =>
        multi.zRangeByScoreWithScores(key, startTs, endTs)
      );
      const results = await multi.exec();

      for (const rangeResult of results) {
        if (!rangeResult) continue;
        for (const member of rangeResult) {
          try {
            const pointData = JSON.parse(member.value);
            if ((pointData.status || 0) >= 500) {
              allErrors.push({ ...pointData, ts: member.score });
              if (allErrors.length >= maxScan) break;
            }
          } catch (e) {
            // ignore
          }
        }
        if (allErrors.length >= maxScan) break;
      }

      if (allErrors.length >= maxScan) break;
    }

    allErrors.sort((a, b) => a.ts - b.ts);

    parentPort.postMessage({ success: true, data: allErrors });
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err?.message || String(err),
    });
  } finally {
    try {
      await client.disconnect();
    } catch (e) {
      // ignore
    }
  }
}

run();
