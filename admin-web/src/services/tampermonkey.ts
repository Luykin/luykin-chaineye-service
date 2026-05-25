import { apiRequest } from "./apiClient";

export interface CollectorTokenItem {
  id: number;
  name: string;
  tokenPrefix: string;
  isActive: boolean;
  expiresAt: string;
  lastUsedAt?: string | null;
  createdByAdminId?: number | null;
  createdByAdminEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  expired: boolean;
}

export interface CollectorTokenListResponse {
  success: boolean;
  data: CollectorTokenItem[];
}

export interface CollectorTokenCreateResponse {
  success: boolean;
  data: {
    token: string;
    item: CollectorTokenItem;
  };
}

export interface TampermonkeyScriptItem {
  fileName: string;
  size: number;
  updatedAt: string;
}

export interface TampermonkeyScriptListResponse {
  success: boolean;
  data: TampermonkeyScriptItem[];
}

export interface TampermonkeyScriptContentResponse {
  success: boolean;
  data: TampermonkeyScriptItem & {
    content: string;
  };
}

export async function fetchCollectorTokens() {
  return apiRequest<CollectorTokenListResponse>("/api/admin/tampermonkey/tokens");
}

export async function createCollectorToken(params: { name: string }) {
  return apiRequest<CollectorTokenCreateResponse>("/api/admin/tampermonkey/tokens", {
    method: "POST",
    body: params,
  });
}

export async function revokeCollectorToken(id: number) {
  return apiRequest<{ success: boolean; data: CollectorTokenItem }>(
    `/api/admin/tampermonkey/tokens/${id}/revoke`,
    { method: "PATCH" }
  );
}

export async function fetchTampermonkeyScripts() {
  return apiRequest<TampermonkeyScriptListResponse>("/api/admin/tampermonkey/scripts");
}

export async function fetchTampermonkeyScriptContent(fileName: string) {
  return apiRequest<TampermonkeyScriptContentResponse>(
    `/api/admin/tampermonkey/scripts/${encodeURIComponent(fileName)}`
  );
}
