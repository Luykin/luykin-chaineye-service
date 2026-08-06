import { apiRequest } from "./apiClient";

export interface KolMarketingFilters {
  language?: string;
  domains?: string[];
  keywords?: string[];
  cooperationTypes?: string[];
  marketingGoals?: string[];
  projectStages?: string[];
  willingnessLevel?: string;
  identityTier?: string;
  minFollowers?: number;
  maxFollowers?: number;
}

export interface KolMarketingSearchItem {
  twitterUserId: string;
  handle: string;
  name?: string | null;
  language?: string | null;
  domains?: string[] | null;
  followers?: number | null;
  aiRankGlobal?: number | null;
  aiRankCn?: number | null;
  web3RankGlobal?: number | null;
  web3RankCn?: number | null;
  marketingSummaryCn?: string | null;
  marketingSummaryEn?: string | null;
  keywords?: string[] | null;
  cooperationTypes?: string[] | null;
  marketingGoals?: string[] | null;
  projectStages?: string[] | null;
  willingnessLevel?: string | null;
  willingnessScore?: number | null;
  willingnessReason?: string | null;
  identityTier?: string | null;
  embeddingModel?: string | null;
  embeddingVersion?: string | null;
  embeddingGeneratedAt?: string | null;
  similarity?: number | string | null;
}

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
  maxLimit: number;
}

export interface KolMarketingSearchData {
  items: KolMarketingSearchItem[];
  filters: KolMarketingFilters;
  limit: number;
  semanticQuery: string;
  embeddingModel?: string | null;
  embeddingCacheHit?: boolean;
  dbCostMs?: number;
  totalCostMs?: number;
  serviceStatus?: KolMarketingServiceStatus;
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

export function searchKolMarketingProfiles(payload: {
  query: string;
  filters?: KolMarketingFilters;
  limit?: number;
}) {
  return apiRequest<ApiEnvelope<KolMarketingSearchData>>("/api/admin/kol-marketing/search", {
    method: "POST",
    headers: { "x-request-id": `admin-kol-marketing-${Date.now()}-${Math.random().toString(16).slice(2)}` },
    body: payload,
  });
}
