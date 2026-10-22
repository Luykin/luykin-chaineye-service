import { apiRequest } from "./apiClient";

export type E2eCampaignStatus = "pending" | "active" | "review" | "complete";
export type E2eCampaignType = "mindshare" | "equal";
export type E2eCampaignLang = "all" | "zh" | "cn" | "en";

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
  engageData: unknown;
}

export interface E2eCampaignStats {
  participantCount: number;
  totalPoints: number;
  allocatedRewards: number;
  winnerCount: number;
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
  createTime: string | null;
  updateTime: string | null;
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
