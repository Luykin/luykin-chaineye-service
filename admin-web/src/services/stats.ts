import { apiRequest } from "./apiClient";
import type {
  AuditLogsResponse,
  BackupStatusResponse,
  ClearCacheResponse,
  DauDetailsResponse,
  DailyCohortsResponse,
  DeviceStatusResponse,
  ErrorLogsResponse,
  GenericStatsAggregateResponse,
  GenericStatsEventsResponse,
  GenericStatsTypesResponse,
  LogSearchResponse,
  NotesResponse,
  OnlineUsersResponse,
  OverviewStatsResponse,
  RootdataDailyResponse,
  RootdataForceVerifyResponse,
  RootdataManualCrawlResponse,
  RootdataQuotaResponse,
  RootdataSetInitialResponse,
  SecurityViolationsResponse,
  RestoreBackupTablesResponse,
  TriggerBackupResponse,
  UrlStatsResponse,
  VersionStatsResponse,
} from "@/types/stats";

export async function fetchOverviewStats() {
  return apiRequest<OverviewStatsResponse>("/api/xhunt/stats/overview");
}

export async function fetchDauDetails(date?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  const query = params.toString();
  return apiRequest<DauDetailsResponse>(
    `/api/xhunt/stats/dau-details${query ? `?${query}` : ""}`
  );
}

export async function fetchDailyCohorts(params?: {
  startDate?: string;
  endDate?: string;
}) {
  const query = new URLSearchParams();
  if (params?.startDate) query.set("startDate", params.startDate);
  if (params?.endDate) query.set("endDate", params.endDate);

  return apiRequest<DailyCohortsResponse>(
    `/api/xhunt/stats/daily-cohorts${query.toString() ? `?${query.toString()}` : ""}`
  );
}

export async function fetchNotes(params?: {
  date?: string;
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params?.date) query.set("date", params.date);
  query.set("page", String(params?.page || 1));
  query.set("limit", String(params?.limit || 50));

  return apiRequest<NotesResponse>(`/api/xhunt/stats/notes?${query.toString()}`);
}

export async function fetchLogSearch(params: {
  query: string;
  scope?: string;
  contextMode?: string;
  contextLines?: number;
  limit?: number;
}) {
  const search = new URLSearchParams();
  search.set("query", params.query);
  search.set("scope", params.scope || "all");
  search.set("contextMode", params.contextMode || "around");
  search.set("contextLines", String(params.contextLines ?? 3));
  search.set("limit", String(params.limit ?? 5));

  return apiRequest<LogSearchResponse>(`/api/xhunt/stats/log-search?${search.toString()}`);
}

export async function fetchErrorLogs(params?: { scope?: string; lines?: number }) {
  const query = new URLSearchParams();
  query.set("scope", params?.scope || "all");
  query.set("lines", String(params?.lines || 1000));
  return apiRequest<ErrorLogsResponse>(`/api/xhunt/stats/error-logs?${query.toString()}`);
}

export async function fetchRootdataQuota() {
  return apiRequest<RootdataQuotaResponse>("/api/xhunt/stats/rootdata-quota");
}

export async function fetchRootdataDaily(params: { date: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  query.set("date", params.date);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  return apiRequest<RootdataDailyResponse>(`/api/xhunt/stats/rootdata-daily?${query.toString()}`);
}

export async function setRootdataInitial(date: string) {
  return apiRequest<RootdataSetInitialResponse>("/api/xhunt/stats/rootdata-daily/set-initial", {
    method: "POST",
    body: { date },
  });
}

export async function forceVerifyRootdata(params: {
  keyword?: string;
  twitterUrl?: string;
  projectLink?: string;
}) {
  const query = new URLSearchParams();
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.twitterUrl) query.set("twitterUrl", params.twitterUrl);
  if (params.projectLink) query.set("projectLink", params.projectLink);
  return apiRequest<RootdataForceVerifyResponse>(`/api/rootdata/force-verify?${query.toString()}`);
}

export async function manualCrawlRootdata(params: { url: string; force?: boolean }) {
  return apiRequest<RootdataManualCrawlResponse>("/api/rootdata/manual-crawl", {
    method: "POST",
    body: params,
    headers: {
      "x-request-id": `admin-web-${Date.now()}`,
    },
  });
}

export async function fetchDeviceStatus() {
  return apiRequest<DeviceStatusResponse>("/api/xhunt/stats/device-status");
}

export async function clearCacheByPrefix(prefix: string) {
  return apiRequest<ClearCacheResponse>("/api/xhunt/stats/clear-cache", {
    method: "POST",
    body: { prefix },
  });
}

export async function fetchSecurityViolations(params: {
  page?: number;
  limit?: number;
  reasonCode?: string;
  ip?: string;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page || 1));
  query.set("limit", String(params.limit || 50));
  if (params.reasonCode) query.set("reasonCode", params.reasonCode);
  if (params.ip) query.set("ip", params.ip);
  return apiRequest<SecurityViolationsResponse>(
    `/api/xhunt/stats/security-violations?${query.toString()}`
  );
}

export async function fetchOnlineUsers(params: { page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  return apiRequest<OnlineUsersResponse>(
    `/api/xhunt/stats/online-users?${query.toString()}`
  );
}

export async function fetchGenericStatsTypes() {
  return apiRequest<GenericStatsTypesResponse>("/api/xhunt/stats/generic-stats/types");
}

export async function fetchGenericStatsAggregate(params: {
  type: string;
  dateFrom?: string;
  dateTo?: string;
  subjectId?: string;
}) {
  const query = new URLSearchParams();
  query.set("type", params.type);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.subjectId) query.set("subjectId", params.subjectId);

  return apiRequest<GenericStatsAggregateResponse>(
    `/api/xhunt/stats/generic-stats/aggregate?${query.toString()}`
  );
}

export async function fetchGenericStatsEvents(params: {
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  subjectId?: string;
  actorId?: string;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.subjectId) query.set("subjectId", params.subjectId);
  if (params.actorId) query.set("actorId", params.actorId);
  query.set("page", String(params.page || 1));
  query.set("pageSize", String(params.pageSize || 20));

  return apiRequest<GenericStatsEventsResponse>(
    `/api/xhunt/stats/generic-stats/events?${query.toString()}`
  );
}

export async function fetchAuditLogs(params: {
  page?: number;
  limit?: number;
  email?: string;
  action?: string;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page || 1));
  query.set("limit", String(params.limit || 50));
  if (params.email) query.set("email", params.email);
  if (params.action) query.set("action", params.action);

  return apiRequest<AuditLogsResponse>(`/api/xhunt/stats/admin-audit/logs?${query.toString()}`);
}

export async function fetchBackupStatus() {
  return apiRequest<BackupStatusResponse>("/api/xhunt/stats/backup-status");
}

export async function triggerBackup() {
  return apiRequest<TriggerBackupResponse>("/api/xhunt/stats/trigger-backup", {
    method: "POST",
  });
}

export async function restoreBackupTables(params: {
  backupName: string;
  groupKey: string;
  confirmText: string;
}) {
  return apiRequest<RestoreBackupTablesResponse>("/api/xhunt/stats/restore-backup-tables", {
    method: "POST",
    body: params,
  });
}


export async function fetchVersionStats(timeRange: string) {
  const query = new URLSearchParams();
  query.set("timeRange", timeRange);
  return apiRequest<VersionStatsResponse>(`/api/xhunt/stats/version-stats?${query.toString()}`);
}

export async function fetchUrlStats(timeRange: string) {
  const query = new URLSearchParams();
  query.set("timeRange", timeRange);
  return apiRequest<UrlStatsResponse>(`/api/xhunt/stats/url-stats?${query.toString()}`);
}
