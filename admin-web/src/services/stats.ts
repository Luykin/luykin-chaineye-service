import { apiRequest } from "./apiClient";
import type {
  AuditLogsResponse,
  DauDetailsResponse,
  GenericStatsAggregateResponse,
  GenericStatsEventsResponse,
  GenericStatsTypesResponse,
  OnlineUsersResponse,
} from "@/types/stats";

export async function fetchDauDetails(date?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  const query = params.toString();
  return apiRequest<DauDetailsResponse>(
    `/api/xhunt/stats/dau-details${query ? `?${query}` : ""}`
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
