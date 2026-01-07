// src/lib/perf-monitor/processor.js

const BATCH_SIZE = 500; // Increased batch size to handle high queue pressure

class PerfDataProcessor {
  constructor(config) {
    this.redisClient = config.redisClient;
    this.metricsConfig = config.metrics;
    this.traceConfig = config.trace;
    this.processing = false;
  }

  async run() {
    if (this.processing) {
      // console.log('[perf-monitor] Processor is already running. Skipping cycle.');
      return;
    }
    this.processing = true;
    try {
      await this.processEventsQueue();
    } catch (err) {
      console.error("[perf-monitor] Error during processing cycle:", err);
    } finally {
      this.processing = false;
    }

    // After processing, check queue length for monitoring purposes
    try {
      const queueSize = await this.redisClient.lLen("perf:events:queue");
      const highWaterMark = 10000;
      if (queueSize > highWaterMark) {
        console.warn(
          `[perf-monitor] High queue pressure detected! Events queue size: ${queueSize}. Consider increasing BATCH_SIZE or run interval.`
        );
      }
    } catch (monitoringError) {
      console.error(
        "[perf-monitor] Failed to check queue length:",
        monitoringError
      );
    }
  }

  async processEventsQueue() {
    const records = await this.redisClient.lRange(
      "perf:events:queue",
      -BATCH_SIZE,
      -1
    );
    if (!records || records.length === 0) return;

    const metricsByWindow = {};
    // Corrected: Use multi() for redis v4 client
    const metricsMulti = this.redisClient.multi();
    const tracesMulti = this.redisClient.multi();

    for (const record of records) {
      try {
        const event = JSON.parse(record);
        if (!event.requestId) continue;

        // --- 1. Process Aggregated Metrics (for every event) ---
        const { durationMs, status } = event;
        const windowTs =
          Math.floor(event.ts / (this.metricsConfig.timeWindowSecs * 1000)) *
          this.metricsConfig.timeWindowSecs;

        if (!metricsByWindow[windowTs]) {
          metricsByWindow[windowTs] = {
            request_count: 0,
            total_duration: 0,
            status_codes: {},
          };
        }
        const windowMetrics = metricsByWindow[windowTs];
        windowMetrics.request_count += 1;
        windowMetrics.total_duration += durationMs;
        const statusGroup = `${Math.floor(status / 100)}xx`;
        windowMetrics.status_codes[statusGroup] =
          (windowMetrics.status_codes[statusGroup] || 0) + 1;

        // --- 2. Process Scatter Plot Index (for every event) ---
        const hourTs = new Date(event.ts).toISOString().substring(0, 13);
        const indexKey = `perf:trace:index:${hourTs}`;
        const scatterPoint = JSON.stringify({
          requestId: event.requestId,
          durationMs: event.durationMs,
          status: event.status,
          hasDetail: event.hasDetail,
        });
        // Corrected: Use zAdd with the correct syntax for redis v4
        tracesMulti.zAdd(indexKey, { score: event.ts, value: scatterPoint });
        tracesMulti.expire(indexKey, this.traceConfig.retentionHours * 3600);

        // --- 3. Process Detailed Trace (only if detail exists) ---
        if (event.hasDetail && event.details) {
          const detailKey = `perf:trace:detail:${event.requestId}`;
          const detailData = { ...event, ...event.details };
          delete detailData.details; // Flatten the structure
          // Corrected: Use hSet for redis v4
          tracesMulti.hSet(detailKey, detailData);
          tracesMulti.expire(detailKey, this.traceConfig.retentionHours * 3600);
        }
      } catch (e) {
        console.warn("[perf-monitor] Failed to parse event record:", record, e);
      }
    }

    // --- Commit Aggregated Metrics to Redis ---
    const metricsRetentionSeconds = this.metricsConfig.retentionHours * 3600;
    for (const [ts, metrics] of Object.entries(metricsByWindow)) {
      const key = `perf:metrics:${ts}`;
      // Corrected: Use camelCase methods
      metricsMulti.hIncrBy(key, "request_count", metrics.request_count);
      metricsMulti.hIncrByFloat(key, "total_duration", metrics.total_duration);
      for (const [statusGroup, count] of Object.entries(metrics.status_codes)) {
        metricsMulti.hIncrBy(key, `status_${statusGroup}`, count);
      }
      metricsMulti.expire(key, metricsRetentionSeconds);
    }

    // --- Finalize and clean up the queue ---
    // Corrected: Use multi() and lTrim
    const cleanupMulti = this.redisClient.multi();
    cleanupMulti.lTrim("perf:events:queue", 0, -records.length - 1);

    // Execute all batched commands in parallel
    await Promise.all([
      metricsMulti.exec(),
      tracesMulti.exec(),
      cleanupMulti.exec(),
    ]);
  }
}

module.exports = { PerfDataProcessor };
