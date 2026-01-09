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
      const intervalSecs = parseInt(req.query.intervalSecs, 10) || 3600;
      let startTs, endTs;

      if (req.query.startTime && req.query.endTime) {
        startTs = Math.floor(parseInt(req.query.startTime, 10) / 1000);
        endTs = Math.floor(parseInt(req.query.endTime, 10) / 1000);
      } else {
        const rangeHours = parseInt(req.query.rangeHours, 10) || 24;
        const now = Date.now();
        endTs = Math.floor(now / 1000);
        startTs = endTs - rangeHours * 3600;
      }

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

  const { Worker } = require("worker_threads");
  const path = require("path");

  /**
   * GET /kpis
   * Fetches aggregated KPIs for a given time range using a worker thread.
   */
  router.get("/kpis", (req, res) => {
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "startTime and endTime are required" });
    }

    const worker = new Worker(path.resolve(__dirname, "kpi-worker.js"), {
      workerData: {
        startTime,
        endTime,
        // Pass other relevant query params if needed
        minCountForPercentile: req.query.minCountForPercentile,
        maxScan: req.query.maxScan,
      },
    });

    worker.on("message", (message) => {
      if (message.success) {
        res.json(message.data);
      } else {
        console.error("[perf-monitor] KPI worker failed:", message.error);
        res.status(500).json({ error: "Failed to fetch KPIs from worker" });
      }
    });

    worker.on("error", (err) => {
      console.error("[perf-monitor] KPI worker errored:", err);
      res
        .status(500)
        .json({ error: "An unexpected error occurred in the KPI worker" });
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `[perf-monitor] KPI worker stopped with exit code ${code}`
        );
        // The response might have already been sent, so this is for logging.
      }
    });
  });

  /**
   * GET /errors
   * Fetches all error trace points (status >= 500) from the ZSET index within retention.
   * Note: Not affected by UI time range; intended for ops/debug.
   */
  router.get("/errors", async (req, res) => {
    try {
      const now = Date.now();
      const retentionHours = metricsConfig?.retentionHours || 48;
      const startTs = now - retentionHours * 3600 * 1000;

      // Build hourly index keys from retention window to now
      const indexKeys = new Set();
      let currentTime = new Date(startTs);
      const endTimeDate = new Date(now);
      while (currentTime <= endTimeDate) {
        indexKeys.add(
          `perf:trace:index:${currentTime.toISOString().substring(0, 13)}`
        );
        currentTime.setHours(currentTime.getHours() + 1);
      }
      indexKeys.add(
        `perf:trace:index:${endTimeDate.toISOString().substring(0, 13)}`
      );

      const maxScan = parseInt(req.query.maxScan || "100000", 10);

      const multi = redisClient.multi();
      Array.from(indexKeys).forEach((key) =>
        multi.zRangeByScoreWithScores(key, startTs, now)
      );
      const results = await multi.exec();

      const allErrors = [];
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
            // Ignore parse errors
          }
        }
        if (allErrors.length >= maxScan) break;
      }

      // Sort by time ascending for chart
      allErrors.sort((a, b) => a.ts - b.ts);

      res.json(allErrors);
    } catch (err) {
      console.error("[perf-monitor] API /errors failed:", err);
      res.status(500).json({ error: "Failed to fetch error traces" });
    }
  });

  /**
   * GET /traces
   * Fetches trace points for the scatter plot from the ZSET index.
   */
  router.get("/traces", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 15000;
      let startTs, endTs;

      if (req.query.startTime && req.query.endTime) {
        startTs = parseInt(req.query.startTime, 10);
        endTs = parseInt(req.query.endTime, 10);
      } else {
        const hours = parseInt(req.query.hours, 10) || 1;
        endTs = Date.now();
        startTs = endTs - hours * 3600 * 1000;
      }

      const indexKeys = new Set();
      let currentTime = new Date(startTs);
      const endTimeDate = new Date(endTs);

      // Iterate hour by hour to collect all relevant hourly index keys
      while (currentTime <= endTimeDate) {
        indexKeys.add(
          `perf:trace:index:${currentTime.toISOString().substring(0, 13)}`
        );
        currentTime.setHours(currentTime.getHours() + 1);
      }
      // Also add the end time's index key just in case it spans an hour boundary
      indexKeys.add(
        `perf:trace:index:${endTimeDate.toISOString().substring(0, 13)}`
      );

      const multi = redisClient.multi();
      Array.from(indexKeys).forEach((key) =>
        multi.zRangeByScoreWithScores(key, startTs, endTs)
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
        () => Math.random() < 0.08
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
