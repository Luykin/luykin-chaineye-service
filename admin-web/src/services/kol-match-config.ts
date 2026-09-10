import { apiRequest } from "./apiClient";
import type {
  KolMatchConfigResponse,
  KolMatchAccess,
  KolMatchHistoryItem,
  KolMatchPublishResponse,
  KolMatchRuntimeConfigDocument,
  KolMatchValidateResponse,
} from "@/types/kol-match-config";

const BASE = "/api/xhunt/stats/echohunt/kol-match/config";

export function fetchKolMatchConfig() {
  return apiRequest<KolMatchConfigResponse>(BASE);
}

export function validateKolMatchConfig(config: KolMatchRuntimeConfigDocument, reason?: string) {
  return apiRequest<KolMatchValidateResponse>(`${BASE}/validate`, {
    method: "POST",
    body: { config, reason },
  });
}

export function publishKolMatchConfig(params: {
  config: KolMatchRuntimeConfigDocument;
  reason: string;
  productionConfirm?: string;
}) {
  return apiRequest<KolMatchPublishResponse>(`${BASE}/publish`, {
    method: "POST",
    body: params,
  });
}

export function refreshKolMatchConfigCache() {
  return apiRequest<{ success: boolean; data: Record<string, unknown> }>(`${BASE}/refresh-cache`, { method: "POST" });
}

export function fetchKolMatchConfigHistory(limit = 20) {
  return apiRequest<{ success: boolean; data: KolMatchHistoryItem[] }>(`${BASE}/history?limit=${limit}`);
}

export function fetchKolMatchAccesses(status?: "active" | "revoked") {
  const query = status ? `?status=${status}` : "";
  return apiRequest<{ success: boolean; data: KolMatchAccess[] }>(`/api/xhunt/stats/echohunt/kol-match/accesses${query}`);
}

export function grantKolMatchAccess(payload: { twitterHandle: string; twitterId?: string | null }) {
  return apiRequest<{ success: boolean; data: { access: KolMatchAccess; created: boolean } }>("/api/xhunt/stats/echohunt/kol-match/accesses", {
    method: "POST",
    body: payload,
  });
}

export function revokeKolMatchAccess(accessId: string) {
  return apiRequest<{ success: boolean; data: KolMatchAccess }>(`/api/xhunt/stats/echohunt/kol-match/accesses/${encodeURIComponent(accessId)}`, {
    method: "DELETE",
  });
}
