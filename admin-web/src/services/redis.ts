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
