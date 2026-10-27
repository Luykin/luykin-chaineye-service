import { apiRequest } from "./apiClient";

export type E2eCampaignStatus = "pending" | "active" | "review" | "complete";
export type E2eCampaignType = "mindshare" | "equal";
export type E2eCampaignLang = "all" | "zh" | "cn" | "en";

export interface E2eScoringConfig {
  timeDecayFloor: number;
  replyBase: number;
  quoteBase: number;
  lengthCharsPerPoint: number;
  lengthBonusCap: number;
  likeMultiplier: number;
  replyMultiplier: number;
  retweetReceivedMultiplier: number;
  viewsPerPoint: number;
  viewBonusCap: number;
  engagementBonusCap: number;
  maxReplies: number;
  maxQuotes: number;
  rankThreshold1: number;
  rankThreshold2: number;
  rankThreshold3: number;
  rankThreshold4: number;
  rankThreshold5: number;
  rankWeightTop1000: number;
  rankWeightTop5000: number;
  rankWeightTop20000: number;
  rankWeightTop50000: number;
  rankWeightTop100000: number;
  rankWeightDefault: number;
}

export interface E2eCampaign {
  address: string;
  tweetId: string | null;
  userId: string | null;
  ownerUserId: string | null;
  ownerHandle: string;
  ownerImageUrl: string | null;
  text: string;
  summaryCn: string;
  summaryEn: string;
  rewards: number | null;
  fees: number | null;
  depositRewards: number | null;
  target: number | null;
  winners: number | null;
  status: E2eCampaignStatus | null;
  completeTx: string | null;
  type: E2eCampaignType | null;
  lang: E2eCampaignLang | null;
  retro: boolean | null;
  startTime: string | null;
  endTime: string | null;
  participantCount: number;
  scoreConfig: E2eScoringConfig;
}

export interface E2eTweet {
  tweetId: string;
  text: string;
  summaryCn: string;
  summaryEn: string;
  ownerHandle: string;
  ownerImageUrl: string | null;
  ownerUserId: string | null;
  passed: boolean | null;
  flags: {
    political: boolean;
    sexual: boolean;
    violence: boolean;
    abusive: boolean;
  };
  explanation: string | null;
  html: string | null;
}

export interface E2eCampaignStats {
  participantCount: number;
  totalPoints: number;
  allocatedRewards: number;
  winnerCount: number;
}

export interface E2ePaymentStatus {
  address: string;
  campaignStatus: string;
  requiredAmount: string;
  paid: boolean;
  funded: boolean;
  verified: boolean;
  balance: string | number | null;
  message: string;
  checkedAt: string;
}

export interface E2ePublishAccess {
  id: string;
  twitterId: string | null;
  twitterHandle: string;
  authCenterUserId: string | null;
  xhuntUserId: string | null;
  status: "active" | "revoked" | string;
  grantedAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type E2ePublishAccessMode = "allowlist" | "all";

export interface E2ePublishAccessModeResult {
  mode: E2ePublishAccessMode;
  changed?: boolean;
  access: E2ePublishAccess | null;
}

export interface E2ePublishAccessBulkResult {
  source: "vip" | "internal_test";
  total: number;
  created: number;
  existing: number;
  failed: number;
}

export interface E2eCampaignDetail {
  campaign: E2eCampaign;
  tweet: E2eTweet | null;
  stats: E2eCampaignStats;
}

export interface E2eCampaignRecord {
  userId: string;
  address: string;
  tweetId: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
  fanRank: number | null;
  point: number | null;
  rewards: number | null;
  userAddress: string | null;
  explanation: string | null;
  scoreBreakdown: E2eScoreBreakdown | null;
  createTime: string | null;
  updateTime: string | null;
}

export interface E2eInteractionScore {
  id: string;
  type: "reply" | "quote" | "retweet";
  text: string;
  createTime: string | null;
  metrics: { likes: number; replies: number; retweets: number; views: number };
  base: number;
  charLength: number;
  lengthBonus: number;
  engagementBonus: number;
  timeWeight: number;
  scoreBeforeDecay: number;
  score: number;
  counted: boolean;
  reason: string | null;
  userId?: string;
  username?: string;
  profileImageUrl?: string | null;
  finalUserPoint?: number | null;
}

export interface E2eScoreBreakdown {
  version: number;
  policy: Record<string, unknown>;
  rawScore: number;
  rankMultiplier: number;
  point: number;
  interactions: E2eInteractionScore[];
  captured: { replies: number; quotes: number; ordinaryRetweet: boolean };
}

export interface E2eSettlementItem {
  id: string;
  userId: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
  payoutAddress: string | null;
  fanRank: number | null;
  point: number;
  rank: number | null;
  rewardAmount: string;
  isWinner: boolean;
  excluded: boolean;
  exclusionReason: string | null;
  excludedBy: string | null;
  excludedByEmail: string | null;
  excludedAt: string | null;
  scoreBreakdown: E2eScoreBreakdown | null;
  interactions: E2eInteractionScore[];
}

export type E2eSettlementStatus = "draft" | "approved" | "submitting" | "submitted" | "confirmed" | "completed_no_payout" | "failed" | "superseded";

export interface E2eDistributionExecution {
  phase: "submission_pending" | "submission_failed" | "waiting" | "executable" | "executed" | "unknown";
  contractAddress?: string;
  salt?: string;
  tokenAddress?: string;
  recipients: Array<{ address: string; amount: string }>;
  submittedAt: string | null;
  earliestExecuteAt: string | null;
  waitTimeSeconds: number | null;
}

export interface E2eSettlement {
  id: string;
  campaignAddress: string;
  revision: number;
  status: E2eSettlementStatus;
  rewardPool: string;
  feeAmount: string;
  depositAmount: string;
  winnerCount: number;
  excludedCount: number;
  uniqueRecipientCount: number;
  calculationConfig: Record<string, unknown>;
  distributionRecipients: Array<{ address: string; amount: string }>;
  generatedAt: string;
  payoutDueAt: string;
  approvedBy: string | null;
  approvedByEmail: string | null;
  approvedAt: string | null;
  submittedBy: string | null;
  submittedByEmail: string | null;
  submittedAt: string | null;
  distributionStatus: string;
  txHash: string | null;
  confirmedAt: string | null;
  lastError: string | null;
  providerResponse: unknown;
  distributionExecution: E2eDistributionExecution | null;
  items: E2eSettlementItem[];
}

export interface E2eInteractionSubmissionDiagnostic {
  id: string;
  tweetId: string;
  tweetUrl: string;
  type: "reply" | "quote";
  status: string;
  userId: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
  text: string;
  interactionCreatedAt: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  metrics: { likes: number; replies: number; retweets: number; quotes: number; views: number };
  counted: boolean;
  score: number | null;
  reason: string | null;
}

export interface E2eDiagnostics {
  submissionStats: {
    total: number;
    verified: number;
    replies: number;
    quotes: number;
    refreshFailed: number;
    oldestRefreshedAt: string | null;
    latestRefreshedAt: string | null;
  };
  submissions: E2eInteractionSubmissionDiagnostic[];
  scores: E2eCampaignRecord[];
  scoreLogs: Array<{
    userId: string;
    username: string;
    point: number | null;
    explanation: string | null;
    scoreBreakdown: E2eScoreBreakdown | null;
    calculatedAt: string;
  }>;
}

export interface E2ePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface E2eCampaignStatusCounts {
  pending: number;
  active: number;
  review: number;
  complete: number;
  total: number;
}

export interface E2eCampaignListResult {
  list: E2eCampaign[];
  pagination: E2ePagination;
  statusCounts: E2eCampaignStatusCounts;
}

export interface E2eCampaignRecordsResult {
  list: E2eCampaignRecord[];
  pagination: E2ePagination;
}

export interface E2eCampaignUpdatePayload {
  rewards?: string;
  fees?: string;
  target?: number;
  winners?: number;
  type?: E2eCampaignType;
  lang?: E2eCampaignLang;
  retro?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface E2eCampaignDeleteResult {
  address: string;
  tweetId: string | null;
  status: string | null;
  deleted: {
    settlementItems: number;
    settlements: number;
    interactions: number;
    crawlRuns: number;
    records: number;
    scoreLogs: number;
  };
  tweetCacheDeleted: false;
  externalPaymentOrderDeleted: false;
}

const base = "/api/admin/e2e-campaigns";

export const listCampaigns = (params: { page: number; pageSize: number; status?: string; keyword?: string }) => {
  const search = new URLSearchParams();
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  if (params.status) search.set("status", params.status);
  if (params.keyword) search.set("keyword", params.keyword);
  return apiRequest<{ success: boolean; data: E2eCampaignListResult }>(`${base}/campaigns?${search.toString()}`);
};

export const getCampaign = (address: string) =>
  apiRequest<{ success: boolean; data: E2eCampaignDetail }>(`${base}/campaigns/${encodeURIComponent(address)}`);

export const getCampaignPaymentStatus = (address: string) =>
  apiRequest<{ success: boolean; data: E2ePaymentStatus }>(
    `${base}/campaigns/${encodeURIComponent(address)}/payment-status`
  );

export const listE2ePublishAccesses = (status: "active" | "revoked" = "active") =>
  apiRequest<{ success: boolean; data: E2ePublishAccess[] }>(
    `${base}/publish-accesses?status=${encodeURIComponent(status)}`
  );

export const getE2ePublishAccessMode = () =>
  apiRequest<{ success: boolean; data: E2ePublishAccessModeResult }>(`${base}/publish-access-mode`);

export const updateE2ePublishAccessMode = (mode: E2ePublishAccessMode) =>
  apiRequest<{ success: boolean; data: E2ePublishAccessModeResult }>(
    `${base}/publish-access-mode`,
    { method: "PUT", body: { mode } }
  );

export const grantE2ePublishAccess = (twitterHandle: string) =>
  apiRequest<{ success: boolean; data: { access: E2ePublishAccess; created: boolean } }>(
    `${base}/publish-accesses`,
    { method: "POST", body: { twitterHandle } }
  );

export const bulkGrantE2ePublishAccess = (source: "vip" | "internal_test") =>
  apiRequest<{ success: boolean; data: E2ePublishAccessBulkResult }>(
    `${base}/publish-accesses/bulk`,
    { method: "POST", body: { source } }
  );

export const revokeE2ePublishAccess = (accessId: string) =>
  apiRequest<{ success: boolean; data: E2ePublishAccess }>(
    `${base}/publish-accesses/${encodeURIComponent(accessId)}`,
    { method: "DELETE" }
  );

export const listCampaignRecords = (address: string, page: number, pageSize: number) => {
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("pageSize", String(pageSize));
  return apiRequest<{ success: boolean; data: E2eCampaignRecordsResult }>(
    `${base}/campaigns/${encodeURIComponent(address)}/records?${search.toString()}`
  );
};

export const updateCampaign = (address: string, body: E2eCampaignUpdatePayload) =>
  apiRequest<{ success: boolean; data: E2eCampaignDetail }>(
    `${base}/campaigns/${encodeURIComponent(address)}`,
    { method: "PUT", body: { ...body } }
  );

export const deleteCampaign = (address: string, confirmation: string) =>
  apiRequest<{ success: boolean; data: E2eCampaignDeleteResult }>(
    `${base}/campaigns/${encodeURIComponent(address)}`,
    { method: "DELETE", body: { confirmation } }
  );

export const forceActivateCampaign = (address: string) =>
  apiRequest<{ success: boolean; data: E2eCampaignDetail }>(
    `${base}/campaigns/${encodeURIComponent(address)}/force-activate`,
    { method: "POST" }
  );

export const completeCampaign = (address: string, txHash: string) =>
  apiRequest<{ success: boolean; data: E2eCampaignDetail }>(
    `${base}/campaigns/${encodeURIComponent(address)}/complete`,
    { method: "POST", body: { txHash } }
  );

export const getCampaignSettlement = (address: string) =>
  apiRequest<{ success: boolean; data: E2eSettlement | null }>(
    `${base}/campaigns/${encodeURIComponent(address)}/settlement`
  );

export const recalculateCampaignSettlement = (address: string) =>
  apiRequest<{ success: boolean; data: E2eSettlement }>(
    `${base}/campaigns/${encodeURIComponent(address)}/settlement/recalculate`,
    { method: "POST" }
  );

export const setSettlementItemExclusion = (
  address: string,
  itemId: string,
  excluded: boolean,
  reason?: string,
) => apiRequest<{ success: boolean; data: E2eSettlement }>(
  `${base}/campaigns/${encodeURIComponent(address)}/settlement/items/${encodeURIComponent(itemId)}/exclusion`,
  { method: "PATCH", body: { excluded, reason } }
);

export const approveCampaignSettlement = (address: string) =>
  apiRequest<{ success: boolean; data: E2eSettlement }>(
    `${base}/campaigns/${encodeURIComponent(address)}/settlement/approve`,
    { method: "POST" }
  );

export const distributeCampaignSettlement = (address: string) =>
  apiRequest<{ success: boolean; data: E2eSettlement }>(
    `${base}/campaigns/${encodeURIComponent(address)}/settlement/distribute`,
    { method: "POST" }
  );

export const refreshCampaignSettlement = (address: string) =>
  apiRequest<{ success: boolean; data: E2eSettlement }>(
    `${base}/campaigns/${encodeURIComponent(address)}/settlement/refresh`,
    { method: "POST" }
  );

export const getCampaignDiagnostics = (address: string) =>
  apiRequest<{ success: boolean; data: E2eDiagnostics }>(
    `${base}/campaigns/${encodeURIComponent(address)}/diagnostics`
  );

export const updateCampaignScoringConfig = (address: string, config: E2eScoringConfig) =>
  apiRequest<{ success: boolean; data: { detail: E2eCampaignDetail; settlement: E2eSettlement | null } }>(
    `${base}/campaigns/${encodeURIComponent(address)}/scoring-config`,
    { method: "PUT", body: { config } }
  );
