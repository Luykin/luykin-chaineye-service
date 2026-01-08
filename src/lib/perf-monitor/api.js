// src/lib/perf-monitor/api.js

const express = require("express");

/**
 * Creates the API router for the performance monitor.
 * @param {object} config - The configuration object.
 * @param {object} config.redisClient - The Redis client instance.
 * @param {object} config.metrics - Configuration for metrics.
 * @returns {object} The Express router.
 */
function createApiRouter(config) {
  const router = express.Router();
  const { redisClient, metrics: metricsConfig } = config;

  /**
   * GET /metrics
   * Fetches aggregated metrics for a given time range and interval.
   */
  router.get("/metrics", async (req, res) => {
    try {
      const rangeHours = parseInt(req.query.rangeHours, 10) || 24;
      const intervalSecs = parseInt(req.query.intervalSecs, 10) || 3600;
      const now = Date.now();
      const endTs = Math.floor(now / 1000);
      const startTs = endTs - rangeHours * 3600;

      const timeWindowSecs = metricsConfig.timeWindowSecs;
      // Corrected: Use multi() for redis v4
      const multi = redisClient.multi();

      for (let ts = startTs; ts < endTs; ts += timeWindowSecs) {
        const windowStartTs = Math.floor(ts / timeWindowSecs) * timeWindowSecs;
        const key = `perf:metrics:${windowStartTs}`;
        // Corrected: Use hGetAll for redis v4
        multi.hGetAll(key);
      }

      const results = await multi.exec();
      const metricsByInterval = {};

      results.forEach((data, i) => {
        if (data === null || Object.keys(data).length === 0) return;

        const currentWindowTs = startTs + i * timeWindowSecs;
        const intervalKey =
          Math.floor(currentWindowTs / intervalSecs) * intervalSecs;

        if (!metricsByInterval[intervalKey]) {
          metricsByInterval[intervalKey] = {
            request_count: 0,
            total_duration: 0,
          };
        }
        const intervalMetrics = metricsByInterval[intervalKey];
        intervalMetrics.request_count += parseInt(data.request_count, 10) || 0;
        intervalMetrics.total_duration += parseFloat(data.total_duration) || 0;
        for (const key in data) {
          if (key.startsWith("status_")) {
            intervalMetrics[key] =
              (intervalMetrics[key] || 0) + (parseInt(data[key], 10) || 0);
          }
        }
      });

      const formattedMetrics = Object.entries(metricsByInterval).map(
        ([ts, data]) => ({
          timestamp: parseInt(ts, 10) * 1000,
          avg_duration_ms:
            data.request_count > 0
              ? data.total_duration / data.request_count
              : 0,
          ...data,
        })
      );

      res.json(formattedMetrics);
    } catch (err) {
      console.error("[perf-monitor] API /metrics failed:", err);
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  });

  /**
   * GET /traces
   * Fetches trace points for the scatter plot from the ZSET index.
   */
  router.get("/traces", async (req, res) => {
    try {
      const hours = parseInt(req.query.hours, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 10000;
      const now = Date.now();
      const startTs = now - hours * 3600 * 1000;

      const indexKeys = [];
      for (let i = 0; i <= hours; i++) {
        const d = new Date(now - i * 3600 * 1000);
        indexKeys.push(`perf:trace:index:${d.toISOString().substring(0, 13)}`);
      }

      const multi = redisClient.multi();
      indexKeys.forEach((key) =>
        multi.zRangeByScoreWithScores(key, startTs, now)
      );
      const results = await multi.exec();

      let allTraces = [];
      for (const rangeResult of results) {
        if (!rangeResult) continue;
        for (const member of rangeResult) {
          try {
            const pointData = JSON.parse(member.value);
            allTraces.push({ ...pointData, ts: member.score });
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      const tracesWithDetail = allTraces.filter((t) => t.hasDetail);
      const tracesWithoutDetail = allTraces.filter((t) => !t.hasDetail);

      const sampledTraces = tracesWithoutDetail.filter(
        () => Math.random() < 0.2
      );

      const combinedTraces = [...tracesWithDetail, ...sampledTraces];

      const finalTraces = combinedTraces
        .sort((a, b) => a.ts - b.ts)
        .slice(-limit);

      res.json(finalTraces);
    } catch (err) {
      console.error("[perf-monitor] API /traces failed:", err);
      res.status(500).json({ error: "Failed to fetch traces" });
    }
  });

  /**
   * GET /trace/:requestId
   * Fetches the full detail for a single trace.
   */
  router.get("/trace/:requestId", async (req, res) => {
    try {
      const { requestId } = req.params;
      // Corrected: Use hGetAll for redis v4
      const trace = await redisClient.hGetAll(`perf:trace:detail:${requestId}`);
      if (Object.keys(trace).length === 0) {
        return res.status(404).json({ error: "Trace not found" });
      }
      res.json(trace);
    } catch (err) {
      console.error(
        `[perf-monitor] API /trace/${req.params.requestId} failed:`,
        err
      );
      res.status(500).json({ error: "Failed to fetch trace detail" });
    }
  });

  /**
   * GET /queue-status
   * Fetches the current length of the events queue.
   */
  router.get("/queue-status", async (req, res) => {
    try {
      const queueLength = await redisClient.lLen("perf:events:queue");
      res.json({ success: true, queueLength });
    } catch (err) {
      console.error("[perf-monitor] API /queue-status failed:", err);
      res.status(500).json({ error: "Failed to fetch queue status" });
    }
  });

  return router;
}

module.exports = { createApiRouter };
