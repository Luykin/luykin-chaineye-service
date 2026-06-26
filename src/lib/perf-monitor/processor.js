// src/lib/perf-monitor/processor.js

const BATCH_SIZE = 500; // Keep increased batch size to handle high queue pressure
const PERF_QUEUE_KEY = "perf:events:queue";

class PerfDataProcessor {
  constructor(config) {
    this.redisClient = config.redisClient;
    this.metricsConfig = config.metrics;
    this.traceConfig = config.trace;
    this.processing = false;
    this.logSuccess = config.logSuccess === true;
    this.maxQueueLength = Number(config.maxQueueLength) || 5000;
    this.trimQueueToLength = Number(config.trimQueueToLength) || 1000;
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

    // After processing, check queue length for monitoring purposes.
    // 性能监控优先级低：积压过大时直接裁剪旧数据，保障业务 Redis 优先。
    await this.enforceQueueLimit();
  }

  async enforceQueueLimit() {
    if (!this.maxQueueLength || this.maxQueueLength <= 0) return;

    try {
      const queueSize = await this.redisClient.lLen(PERF_QUEUE_KEY);
      if (queueSize <= this.maxQueueLength) return;

      const trimToLength = Math.max(
        0,
        Math.min(this.trimQueueToLength, this.maxQueueLength)
      );

      if (trimToLength > 0) {
        // LPUSH 写入新事件在左侧，保留左侧最近数据，丢弃右侧旧积压。
        await this.redisClient.lTrim(PERF_QUEUE_KEY, 0, trimToLength - 1);
      } else {
        await this.redisClient.del(PERF_QUEUE_KEY);
      }

      console.warn("[perf-monitor] Queue backlog trimmed", {
        queueSize,
        maxQueueLength: this.maxQueueLength,
        trimToLength,
        droppedApprox: Math.max(0, queueSize - trimToLength),
      });
    } catch (monitoringError) {
      console.error(
        "[perf-monitor] Failed to enforce queue limit:",
        monitoringError
      );
    }
  }

  async processEventsQueue() {
    const records = await this.redisClient.lRange(
      PERF_QUEUE_KEY,
      -BATCH_SIZE,
      -1
    );
    if (!records || records.length === 0) return;

    const metricsByWindow = {};
    const metricsMulti = this.redisClient.multi();
    const tracesMulti = this.redisClient.multi();
    let hasTraceCommands = false;

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

        // --- 2. Process Scatter Plot Index ---
        // 默认只索引慢请求 / 错误请求 / 采样请求，避免每个请求都写 ZSET 打满 Redis CPU。
        // 如需恢复旧行为，可设置 trace.indexAllRequests = true。
        const shouldIndexTrace =
          this.traceConfig.indexAllRequests === true || !!event.hasDetail;
        if (shouldIndexTrace) {
          // NOTE: path/userId must always exist in scatter payload, default to empty string
          const hourTs = new Date(event.ts).toISOString().substring(0, 13);
          const indexKey = `perf:trace:index:${hourTs}`;
          const scatterPoint = JSON.stringify({
            requestId: event.requestId,
            durationMs: event.durationMs,
            status: event.status,
            path: event.path,
            userId: event.userId || event.details?.userId || "N/A",
            // 基础索引点也记录 clientIp，便于前端按 IP 筛选/定位异常流量
            ip: event.ip || "",
            source: event.source || "legacy",
            webClientKey: event.webClientKey || "",
            webSignResult: event.webSignResult || "",
            webSignFailReason: event.webSignFailReason || "",
            pageUrl: event.pageUrl || "",
            hasDetail: !!event.hasDetail,
          });
          // Corrected: zAdd for redis v4 expects an array of members
          tracesMulti.zAdd(indexKey, [{ score: event.ts, value: scatterPoint }]);
          tracesMulti.expire(indexKey, this.traceConfig.retentionHours * 3600);
          hasTraceCommands = true;
        }

        // --- 3. Process Detailed Trace (only if detail exists) ---
        if (event.hasDetail && event.details) {
          const detailKey = `perf:trace:detail:${event.requestId}`;
          const detailData = { ...event, ...event.details };
          delete detailData.details; // Flatten the structure

          // Corrected: Ensure all values are strings for hSet to avoid type errors
          const stringifiedDetailData = {};
          for (const key in detailData) {
            if (
              typeof detailData[key] === "object" &&
              detailData[key] !== null
            ) {
              stringifiedDetailData[key] = JSON.stringify(detailData[key]);
            } else {
              stringifiedDetailData[key] = String(detailData[key]);
            }
          }

          tracesMulti.hSet(detailKey, stringifiedDetailData);
          tracesMulti.expire(detailKey, this.traceConfig.retentionHours * 3600);
          hasTraceCommands = true;
        }
      } catch (e) {
        console.warn("[perf-monitor] Failed to parse event record:", record, e);
      }
    }

    // --- Commit Aggregated Metrics to Redis ---
    const metricsRetentionSeconds = this.metricsConfig.retentionHours * 3600;
    let hasMetricsCommands = false;
    for (const [ts, metrics] of Object.entries(metricsByWindow)) {
      const key = `perf:metrics:${ts}`;
      metricsMulti.hIncrBy(key, "request_count", metrics.request_count);
      metricsMulti.hIncrByFloat(key, "total_duration", metrics.total_duration);
      for (const [statusGroup, count] of Object.entries(metrics.status_codes)) {
        metricsMulti.hIncrBy(key, `status_${statusGroup}`, count);
      }
      metricsMulti.expire(key, metricsRetentionSeconds);
      hasMetricsCommands = true;
    }

    // --- Finalize and clean up the queue ---
    const cleanupMulti = this.redisClient.multi();
    cleanupMulti.lTrim(PERF_QUEUE_KEY, 0, -records.length - 1);

    // Execute all batched commands in parallel.
    // trace 写入默认是采样的，可能没有任何命令；避免空 multi 在不同 redis 客户端版本中的兼容风险。
    const execPromises = [cleanupMulti.exec()];
    if (hasMetricsCommands) {
      execPromises.push(metricsMulti.exec());
    }
    if (hasTraceCommands) {
      execPromises.push(tracesMulti.exec());
    }
    await Promise.all(execPromises);

    if (records.length > 0 && this.logSuccess) {
      console.log(
        `[perf-monitor-success-processor] Processed ${records.length} events from the queue.`
      );
    }
  }
}

module.exports = { PerfDataProcessor };
