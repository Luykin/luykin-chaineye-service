import { apiRequest } from "./apiClient";
import type {
  SpecialMarkerItem,
  SpecialMarkersResponse,
  SpecialMarkerMutationResponse,
  SpecialMarkerBatchResponse,
  ResolveTwidResponse,
} from "@/types/specialMarkers";

export interface FetchMarkersParams {
  keyword?: string;
  colorPreset?: string;
  visibleScope?: string;
  enabled?: string;
}

export async function fetchSpecialMarkers(params: FetchMarkersParams = {}) {
  const query = new URLSearchParams();
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.colorPreset && params.colorPreset !== "all") query.set("colorPreset", params.colorPreset);
  if (params.visibleScope && params.visibleScope !== "all") query.set("visibleScope", params.visibleScope);
  if (params.enabled && params.enabled !== "all") query.set("enabled", params.enabled);

  const qs = query.toString();
  const url = `/api/xhunt/stats/special-markers${qs ? `?${qs}` : ""}`;
  return apiRequest<SpecialMarkersResponse>(url);
}

export async function upsertSpecialMarker(payload: Partial<SpecialMarkerItem>) {
  return apiRequest<SpecialMarkerMutationResponse>("/api/xhunt/stats/special-markers", {
    method: "POST",
    body: payload,
  });
}

export async function batchImportSpecialMarkers(payload: {
  usernames: string;
  markerText: string;
  colorPreset?: string;
  variant?: string;
  icon?: string;
  effect?: string;
  description?: string;
  linkUrl?: string;
  visibleScope?: string;
  visibleTwids?: string[];
  enabled?: boolean;
}) {
  return apiRequest<SpecialMarkerBatchResponse>("/api/xhunt/stats/special-markers/batch", {
    method: "POST",
    body: payload,
  });
}

export async function toggleSpecialMarker(id: number) {
  return apiRequest<SpecialMarkerMutationResponse>(`/api/xhunt/stats/special-markers/${id}/toggle`, {
    method: "PATCH",
  });
}

export async function deleteSpecialMarker(id: number) {
  return apiRequest<{ success: boolean; data: { id: number } }>(`/api/xhunt/stats/special-markers/${id}`, {
    method: "DELETE",
  });
}

export async function resolveTwitterId(username: string) {
  return apiRequest<ResolveTwidResponse>("/api/xhunt/stats/special-markers/resolve-twid", {
    method: "POST",
    body: { username },
  });
}

export async function syncTwitterIds() {
  return apiRequest<{ success: boolean; data: { synced: number; totalPending: number } }>(
    "/api/xhunt/stats/special-markers/sync-twitter-ids",
    {
      method: "POST",
    }
  );
}
