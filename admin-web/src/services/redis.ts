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
