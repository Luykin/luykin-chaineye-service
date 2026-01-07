// src/lib/perf-monitor/index.js

const { createPerfMiddleware } = require("./middleware");
const { PerfDataProcessor } = require("./processor");
const { createApiRouter } = require("./api");

/**
 * Initializes the performance monitoring module.
 *
 * @param {object} config - The main configuration object.
 * @param {object} config.redisClient - A connected ioredis client instance. Required.
 * @param {Array} [config.requestIdFrom=['headers', 'x-request-id']] - Where to extract the request ID from.
 * @param {object} [config.collectDetailedInfo] - Configuration for which fields to collect for detailed traces.
 * @param {number} [config.flushThreshold=100] - Number of records to buffer before flushing.
 * @param {number} [config.flushIntervalMs=5000] - Max interval to wait before flushing.
 * @param {object} config.trace - Configuration for detailed request tracing.
 * @param {object} config.metrics - Configuration for aggregated metrics.
 * @returns {{middleware: Function, processor: PerfDataProcessor, apiRouter: import('express').Router}}
 */
function initPerfMonitor(config) {
  if (!config || !config.redisClient) {
    throw new Error(
      "[perf-monitor] `redisClient` is a required configuration property."
    );
  }

  const finalConfig = {
    // Default data extraction configuration
    requestIdFrom: ["headers", "x-request-id"],
    collectDetailedInfo: {
      userId: ["headers", "x-user-id"],
      fingerprint: ["headers", "x-device-fingerprint"],
      version: ["headers", "x-extension-version"],
      location: ["headers", "x-window-location-href"],
      ua: ["get", "user-agent"], // req.get() is a special case
    },
    // Default operational configuration
    flushThreshold: 100,
    flushIntervalMs: 5000,
    ...config, // User-provided config overrides defaults
    trace: {
      sampleRate: 0.01,
      slowThresholdMs: 500,
      retentionHours: 48,
      ...config.trace,
    },
    metrics: {
      timeWindowSecs: 60,
      retentionHours: 48,
      ...config.metrics,
    },
  };

  const middleware = createPerfMiddleware(finalConfig);
  const processor = new PerfDataProcessor(finalConfig);
  const apiRouter = createApiRouter(finalConfig);

  return { middleware, processor, apiRouter };
}

module.exports = { initPerfMonitor };
