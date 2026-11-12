export type AdBannerType = "commercial" | "normal";

export interface AdBannerConfig {
  id: string;
  enabled: boolean;
  /** 条目类型：commercial 优先展示 */
  type: AdBannerType;
  daily_limit: number;
  visible_to: string[];
  image_url_zh: string;
  link_url_zh: string;
  alt_text_zh: string;
  image_url_en: string;
  link_url_en: string;
  alt_text_en: string;
}

export interface FeatureFlagsConfig {
  adBanners?: AdBannerConfig[];
  featureSlots?: AdBannerConfig[];
  flexibleTesting?: Record<string, string[]>;
  testConfig?: {
    features?: string[];
    testers?: string[];
  };
  canaryConfig?: {
    features?: string[];
    canaries?: string[];
  };
  [key: string]: unknown;
}

export interface FeatureFlagsResponse {
  success: boolean;
  data: {
    dataId: string;
    group: string;
    content: string;
  };
}

export interface FeatureFlagsPublishResponse {
  success: boolean;
  data: {
    dataId: string;
    group: string;
    published: boolean;
  };
}

export interface VipListItem {
  id: number;
  username: string | null;
  twitterId?: string | null;
}

export interface VipMembershipItem {
  id: number;
  twitterId: string;
  username: string | null;
  status: "active" | "expired";
  expiresAt: string;
  origin: "legacy_manual" | "membership_api";
  lastApiGrantedAt: string | null;
  lastApiOrderNo: string | null;
  forceExpiredAt: string | null;
  createdAt: string;
}

export interface VipMembershipsResponse {
  success: boolean;
  data: {
    items: VipMembershipItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface VipTwitterIdSyncResponse {
  success: boolean;
  data: {
    total: number;
    updated: number;
    skipped: number;
    failed: number;
    results: Array<{
      id: number;
      username: string;
      status: "success" | "skipped" | "failed";
      twitterId?: string | null;
      error?: string;
    }>;
  };
  error?: string;
}

export interface VipListsResponse {
  success: boolean;
  data: {
    vip: VipListItem[];
    internalTest: VipListItem[];
  };
}
