import { apiRequest } from "./apiClient";

export interface RedisInfo {
  version?: string;
  mode?: string;
  os?: string;
  uptimeInSeconds?: number;
  connectedClients?: number;
  usedMemory?: string;
  usedMemoryPeak?: string;
  totalKeys?: number;
  keyspaceHits?: number;
  keyspaceMisses?: number;
}

export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number | null;
  length?: number;
  size?: number;
  value?: string;
  valueFormatted?: string;
  isJson?: boolean;
  isSensitive?: boolean;
  parsedValue?: unknown;
}


export interface RedisConfigItem {
  key: string;
  label: string;
  type: "text" | "select" | "number";
  options?: string[];
  value: string | null;
  recommendedValue: string;
  placeholder?: string;
  risk: "low" | "medium" | "high";
  description: string;
  recommendation: string;
  isRecommended?: boolean;
}

export interface RedisConfigRuntime {
  usedMemoryHuman?: string | null;
  usedMemoryPeakHuman?: string | null;
  maxmemoryHuman?: string | null;
  maxmemoryPolicy?: string | null;
  rdbBgsaveInProgress?: boolean;
  aofRewriteInProgress?: boolean;
  latestForkUsec?: number | null;
  aofEnabled?: boolean;
}

export interface RedisConfigData {
  items: RedisConfigItem[];
  runtime: RedisConfigRuntime;
}

export interface RedisDiagnosticsRuntime {
  version?: string | null;
  mode?: string | null;
  uptimeInSeconds?: number;
  connectedClients?: number;
  blockedClients?: number;
  totalKeys?: number;
  instantaneousOpsPerSec?: number;
  instantaneousInputKbps?: number;
  instantaneousOutputKbps?: number;
  totalCommandsProcessed?: number;
  rejectedConnections?: number;
  expiredKeys?: number;
  evictedKeys?: number;
  keyspaceHits?: number;
  keyspaceMisses?: number;
  usedMemoryHuman?: string | null;
  usedMemoryPeakHuman?: string | null;
  maxmemoryHuman?: string | null;
  maxmemoryPolicy?: string | null;
  memFragmentationRatio?: number | null;
  usedCpuSys?: number | null;
  usedCpuUser?: number | null;
  usedCpuSysChildren?: number | null;
  usedCpuUserChildren?: number | null;
  rdbBgsaveInProgress?: boolean;
  aofRewriteInProgress?: boolean;
  latestForkUsec?: number | null;
  aofEnabled?: boolean;
}

export interface RedisSlowlogEntry {
  id: number | string;
  timestamp: number | null;
  time: string | null;
  durationUsec: number;
  durationMs: number;
  commandName: string;
  command: string;
  argCount: number;
  clientAddr?: string;
  clientName?: string;
}

export interface RedisCommandStat {
  command: string;
  calls: number;
  usec: number;
  usecPerCall: number;
  rejectedCalls: number;
  failedCalls: number;
}

export interface RedisQueueStat {
  key: string;
  label: string;
  warnAt: number;
  dangerAt: number;
  length: number;
  exists?: boolean;
  error?: string;
}

export interface RedisDiagnosticsFinding {
  id: string;
  severity: "safe" | "info" | "warning" | "danger";
  title: string;
  detail: string;
  advice: string;
}

export interface RedisDiagnosticsData {
  generatedAt: string;
  runtime: RedisDiagnosticsRuntime;
  slowlog: {
    total: number;
    entries: RedisSlowlogEntry[];
  };
  commandStats: RedisCommandStat[];
  queues: RedisQueueStat[];
  findings: RedisDiagnosticsFinding[];
  notes?: string[];
}

export interface RedisSystemdConfigItem {
  key: "CPUQuota" | "CPUWeight" | "Nice" | "IOSchedulingClass" | "IOSchedulingPriority";
  label: string;
  type: "text" | "select" | "number";
  options?: string[];
  value: string | null;
  recommendedValue: string;
  placeholder?: string;
  description: string;
  recommendation: string;
  isRecommended?: boolean;
}

export interface RedisSystemdData {
  supported: boolean;
  reason?: string;
  serviceName: string;
  serviceCandidates: string[];
  overridePath: string;
  systemctlError?: string | null;
  effective: Record<string, string>;
  overrideContent: string;
  pendingRestart: boolean;
  items: RedisSystemdConfigItem[];
  daemonReload?: { stdout?: string; stderr?: string; error?: string } | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export function fetchRedisInfo() {
  return apiRequest<ApiEnvelope<RedisInfo>>("/admin/system/redis/info");
}

export function queryRedisKey(key: string) {
  return apiRequest<ApiEnvelope<RedisKeyInfo | null>>(`/admin/system/redis/query?key=${encodeURIComponent(key)}`);
}

export function scanRedisKeys(pattern: string, count = 100) {
  return apiRequest<ApiEnvelope<{ keys: string[]; count: number; pattern: string }>>(
    `/admin/system/redis/keys?pattern=${encodeURIComponent(pattern || "*")}&count=${count}`
  );
}

export function updateRedisKey(params: { key: string; type?: string; value: unknown; ttl?: number | null }) {
  return apiRequest<ApiEnvelope<unknown>>("/admin/system/redis/update", {
    method: "POST",
    body: params,
  });
}

export function deleteRedisKey(key: string) {
  return apiRequest<ApiEnvelope<unknown>>("/admin/system/redis/delete", {
    method: "DELETE",
    body: { key },
  });
}

export function fetchRedisConfig() {
  return apiRequest<ApiEnvelope<RedisConfigData>>("/admin/system/redis/config");
}

export function updateRedisConfig(params: { key: string; value: string }) {
  return apiRequest<ApiEnvelope<{ key: string; before: string | null; after: string | null; rewriteResult?: string | null }>>("/admin/system/redis/config", {
    method: "POST",
    body: params,
  });
}

export function fetchRedisDiagnostics(slowlogLimit = 30) {
  return apiRequest<ApiEnvelope<RedisDiagnosticsData>>(`/admin/system/redis/diagnostics?slowlogLimit=${slowlogLimit}`);
}

export function resetRedisSlowlog() {
  return apiRequest<ApiEnvelope<{ result?: string }>>("/admin/system/redis/diagnostics/slowlog/reset", {
    method: "POST",
  });
}

export function fetchRedisSystemd(serviceName?: string) {
  const query = serviceName ? `?serviceName=${encodeURIComponent(serviceName)}` : "";
  return apiRequest<ApiEnvelope<RedisSystemdData>>(`/admin/system/redis/systemd${query}`);
}

export function updateRedisSystemd(params: { serviceName: string; values: Record<string, string> }) {
  return apiRequest<ApiEnvelope<RedisSystemdData>>("/admin/system/redis/systemd", {
    method: "POST",
    body: params,
  });
}
