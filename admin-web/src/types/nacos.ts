export interface NacosConfigResponse {
  success: boolean;
  data: {
    dataId: string;
    group: string;
    tenant: string | null;
    content: string;
  };
}

export interface NacosPublishResponse {
  success: boolean;
  data?: {
    dataId: string;
    group: string;
    tenant: string | null;
    published: boolean;
  };
  error?: string;
}

export interface WebsiteCampaignRecord {
  id?: string | number;
  nacosCampaignId: string;
  campaignKey?: string | null;
  slug?: string | null;
  webStatus?: string | null;
  displayNameZh?: string | null;
  displayNameEn?: string | null;
  syncedFromNacosAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
  [key: string]: unknown;
}

export interface WebsiteCampaignListResponse {
  success: boolean;
  data: WebsiteCampaignRecord[];
}

export interface WebsiteCampaignSyncResponse {
  success: boolean;
  summary?: Record<string, unknown>;
  data?: unknown;
  error?: string;
}
