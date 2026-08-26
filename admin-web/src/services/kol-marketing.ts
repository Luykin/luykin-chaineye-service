import { apiRequest } from "./apiClient";

export interface KolMarketingPgReadStatus {
  configured: boolean;
  ready: boolean;
  checkedAt?: string | null;
  server?: {
    databaseName?: string;
    serverAddr?: string;
    serverPort?: number;
    inRecovery?: boolean;
    transactionReadOnly?: string;
  } | null;
  error?: string | null;
}

export interface KolMarketingServiceStatus {
  ready: boolean;
  pgConfigured: boolean;
  pgRead: KolMarketingPgReadStatus;
  embeddingModel: string | null;
  profileStats?: {
    total: number;
    active: number;
    activeWithEmbedding: number;
    activeMissingEmbedding: number;
    activeNeedsEmbeddingRefresh: number;
    activeNeedsAiRefresh: number;
    embeddingCoverage: number;
    checkedAt?: string | null;
  } | null;
  profileStatsError?: string | null;
  filterLlm?: {
    enabled: boolean;
    model?: string | null;
  };
  maxLimit: number;
}

export type KolMarketingProfileRow = Record<string, unknown>;

export interface KolMarketingProfileDebugResult {
  query: string;
  matchedBy: "twitterId" | "handle" | null;
  found: boolean;
  source: "write" | "readonly";
  checkedAt: string;
  dbStatus?: KolMarketingPgReadStatus | Record<string, unknown>;
  collaboration?: {
    acceptingNewInvitations?: boolean | null;
    telegram?: string | null;
    email?: string | null;
    shortPostPrice?: string | number | null;
    shortPostCurrency?: string | null;
    threadPrice?: string | number | null;
    threadCurrency?: string | null;
    updatedAt?: string | null;
    syncedAt?: string | null;
    source?: string | null;
  } | null;
  profile: KolMarketingProfileRow | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}

export function fetchKolMarketingStatus() {
  return apiRequest<ApiEnvelope<KolMarketingServiceStatus>>("/api/admin/kol-marketing/status");
}

export function fetchKolMarketingProfileDebug(query: string) {
  const params = new URLSearchParams({ query });
  return apiRequest<ApiEnvelope<KolMarketingProfileDebugResult>>(`/api/admin/kol-marketing/profile-debug?${params.toString()}`);
}

export function clearKolMarketingProfileCollaboration(twitterId: string) {
  return apiRequest<ApiEnvelope<KolMarketingProfileDebugResult>>("/api/admin/kol-marketing/profile-debug/collaboration", {
    method: "DELETE",
    body: { twitterId },
  });
}
