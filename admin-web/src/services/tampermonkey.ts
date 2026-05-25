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

export interface RootDataProjectSnapshot {
  id: number;
  projectName: string;
  projectLink: string;
  logo?: string | null;
  round?: string | null;
  amount?: string | null;
  formattedAmount?: number | null;
  valuation?: string | null;
  formattedValuation?: number | null;
  date?: string | null;
  fundedAt?: number | null;
  isInitial?: boolean | null;
  socialLinks?: Record<string, string> | null;
  twitterUrl?: string | null;
  teamMembers?: Array<Record<string, unknown>> | null;
  originalPageNumber?: number | null;
  detailFetchedAt?: number | null;
  detailFailuresNumber?: number | null;
  updateProgram?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RootDataInvestmentRelationship {
  id: number;
  investorProjectId: number;
  fundedProjectId: number;
  round?: string | null;
  lead?: boolean | null;
  amount?: string | null;
  formattedAmount?: number | null;
  valuation?: string | null;
  formattedValuation?: number | null;
  date?: number | null;
  updateProgram?: string | null;
  createdAt?: string;
  updatedAt?: string;
  investorProject?: RootDataProjectSnapshot | null;
  fundedProject?: RootDataProjectSnapshot | null;
}

export interface RootDataLookupItem {
  project: RootDataProjectSnapshot;
  investmentsReceived: RootDataInvestmentRelationship[];
  investmentsGiven: RootDataInvestmentRelationship[];
}

export interface RootDataLookupResponse {
  success: boolean;
  data: {
    query: string;
    total: number;
    items: RootDataLookupItem[];
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

export async function lookupRootDataProject(query: string) {
  const params = new URLSearchParams({ q: query, limit: "10" });
  return apiRequest<RootDataLookupResponse>(
    `/api/admin/tampermonkey/rootdata/lookup?${params.toString()}`
  );
}
