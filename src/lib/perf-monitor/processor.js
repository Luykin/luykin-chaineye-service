// src/lib/perf-monitor/processor.js

const BATCH_SIZE = 200; // Number of events to process from the queue at once

class PerfDataProcessor {
  constructor(config) {
    this.redisClient = config.redisClient;
    this.metricsConfig = config.metrics;
    this.traceConfig = config.trace;
    this.processing = false;
  }

  async run() {
    if (this.processing) {
      console.log(
        "[perf-monitor] Processor is already running. Skipping cycle."
      );
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
      const queueSize = await this.redisClient.llen("perf:events:queue");
      const highWaterMark = 10000;
      if (queueSize > highWaterMark) {
        console.warn(
          `[perf-monitor] High queue pressure detected! Events queue size: ${queueSize}. Consider increasing BATCH_SIZE.`
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
    const records = await this.redisClient.lrange(
      "perf:events:queue",
      -BATCH_SIZE,
      -1
    );
    if (!records || records.length === 0) return;

    const metricsByWindow = {};
    const metricsPipeline = this.redisClient.pipeline();
    const tracesPipeline = this.redisClient.pipeline();

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
        tracesPipeline.zadd(indexKey, event.ts, scatterPoint);
        tracesPipeline.expire(indexKey, this.traceConfig.retentionHours * 3600);

        // --- 3. Process Detailed Trace (only if detail exists) ---
        if (event.hasDetail && event.details) {
          const detailKey = `perf:trace:detail:${event.requestId}`;
          const detailData = { ...event, ...event.details };
          delete detailData.details; // Flatten the structure
          tracesPipeline.hset(detailKey, detailData);
          tracesPipeline.expire(
            detailKey,
            this.traceConfig.retentionHours * 3600
          );
        }
      } catch (e) {
        console.warn("[perf-monitor] Failed to parse event record:", record, e);
      }
    }

    // --- Commit Aggregated Metrics to Redis ---
    const metricsRetentionSeconds = this.metricsConfig.retentionHours * 3600;
    for (const [ts, metrics] of Object.entries(metricsByWindow)) {
      const key = `perf:metrics:${ts}`;
      metricsPipeline.hincrby(key, "request_count", metrics.request_count);
      metricsPipeline.hincrbyfloat(
        key,
        "total_duration",
        metrics.total_duration
      );
      for (const [statusGroup, count] of Object.entries(metrics.status_codes)) {
        metricsPipeline.hincrby(key, `status_${statusGroup}`, count);
      }
      metricsPipeline.expire(key, metricsRetentionSeconds);
    }

    // --- Finalize and clean up the queue ---
    const cleanupPipeline = this.redisClient.pipeline();
    cleanupPipeline.ltrim("perf:events:queue", 0, -records.length - 1);

    await Promise.all([
      metricsPipeline.exec(),
      tracesPipeline.exec(),
      cleanupPipeline.exec(),
    ]);
  }
}

module.exports = { PerfDataProcessor };
