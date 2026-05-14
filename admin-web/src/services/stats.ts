import { apiRequest } from "./apiClient";
import type { DauDetailsResponse, OnlineUsersResponse } from "@/types/stats";

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
