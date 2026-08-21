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

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}

export function fetchKolMarketingStatus() {
  return apiRequest<ApiEnvelope<KolMarketingServiceStatus>>("/api/admin/kol-marketing/status");
}
