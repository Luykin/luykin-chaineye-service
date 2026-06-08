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

export interface UserTagItem {
  id: number;
  username: string;
  twitterId?: string | null;
  tagsZh: string[];
  tagsEn: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface UserTagsResponse {
  success: boolean;
  data: UserTagItem[];
  error?: string;
}

export interface UserTagMutationResponse {
  success: boolean;
  data?: UserTagItem;
  error?: string;
}

export interface UserTagSyncResponse {
  success: boolean;
  data: {
    total: number;
    updated?: number;
    skipped: number;
    failed?: number;
    created?: number;
    results?: Array<{
      id: number;
      username: string;
      status: "success" | "skipped" | "failed";
      twitterId?: string | null;
      error?: string;
    }>;
  };
  error?: string;
}

export interface NacosI18nReferenceResponse {
  success: boolean;
  data: {
    source: string;
    urls: Record<string, string>;
    config: Record<string, Record<string, unknown>>;
  };
  error?: string;
}
