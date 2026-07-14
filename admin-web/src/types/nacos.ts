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


export interface CampaignRegistrationItem {
  id: string;
  campaign: string;
  twitterId: string;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  evmAddress?: string | null;
  email?: string | null;
  registrationUrl?: string | null;
  binanceSquareAccount?: {
    id?: number | string;
    twitterId?: string | null;
    binanceSquareUid?: string | null;
    binanceUsername?: string | null;
    binanceDisplayName?: string | null;
    binanceAvatar?: string | null;
    verificationPostUrl?: string | null;
    verifiedAt?: string | null;
    status?: string | null;
  } | null;
  registeredAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  xHuntUser?: {
    displayName?: string | null;
    classification?: string | null;
  } | null;
}

export interface CampaignRegistrationListResponse {
  success: boolean;
  data: {
    total: number;
    page: number;
    pageSize: number;
    rows: CampaignRegistrationItem[];
  };
  error?: string;
}

export type CampaignRegistrationRankDomain = "web3" | "ai";

export interface CampaignRegistrationRankItem {
  domain: CampaignRegistrationRankDomain;
  status: "success" | "missing" | "failed";
  kolRank: number | null;
  rankFollowers: number | null;
  userId: string | null;
  username: string | null;
  isCreator: boolean;
  creatorAuth: {
    status: number | null;
    recordTime: string | null;
    twitterId: string | null;
    isCreatorAuthed: boolean;
  } | null;
  error: string | null;
}

export interface CampaignRegistrationRankEligibility {
  status: "no_threshold" | "eligible" | "not_eligible" | "unavailable";
  eligible: boolean;
  label: string;
  reason: string;
  activeDomains: CampaignRegistrationRankDomain[];
  threshold: number | null;
  includeCreator: boolean;
}

export interface CampaignRegistrationRankCheckRow {
  id: string | null;
  username: string | null;
  twitterId: string;
  ranks: CampaignRegistrationRankItem[];
  eligibility: CampaignRegistrationRankEligibility;
}

export interface CampaignRegistrationRankCheckResponse {
  success: boolean;
  data: {
    campaign: string;
    checkedAt: string;
    campaignRule: {
      threshold: number | null;
      includeCreator: boolean;
      displayDomains: CampaignRegistrationRankDomain[];
    };
    total: number;
    rows: CampaignRegistrationRankCheckRow[];
  };
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

export type NacosSecuritySeverity = "pass" | "low" | "medium" | "high" | "critical";

export interface NacosSecurityEvidenceLine {
  line: number;
  text: string;
}

export interface NacosSecurityStaticFinding {
  id: string;
  severity: NacosSecuritySeverity;
  title: string;
  evidence?: NacosSecurityEvidenceLine[];
  conclusion: string;
  recommendation: string;
  passed?: boolean;
}

export interface NacosSecurityRuntimeCheck {
  id: string;
  title: string;
  method: string;
  path: string;
  url: string;
  category: string;
  status: number | null;
  durationMs: number;
  severity: NacosSecuritySeverity;
  passed: boolean;
  conclusion: string;
  recommendation: string;
  headers?: Record<string, string | undefined>;
  bodySummary?: {
    contentLength: number;
    bodySha256: string | null;
    detectedSensitiveKeys: string[];
    sample: string;
  };
  originalSha256?: string | null;
  afterSha256?: string | null;
  finalSha256?: string | null;
  restoreStatus?: number | null;
  probeMarkerSha256?: string | null;
  error?: string;
}

export interface NacosSecurityCheckResponse {
  success: boolean;
  data: {
    summary: {
      severity: NacosSecuritySeverity;
      checkedAt: string;
      origin: string;
      durationMs: number;
      total: number;
      failed: number;
      critical: number;
      high: number;
      medium: number;
    };
    nginx: {
      path: string;
      exists: boolean;
      findings: NacosSecurityStaticFinding[];
    };
    runtimeChecks: NacosSecurityRuntimeCheck[];
    notes: string[];
  };
  error?: string;
}

export interface NacosAdminConfigMeta {
  dataId: string;
  label: string;
  group: string;
  type: string;
  publicReadable: boolean;
  permissions: string[];
  writable: boolean;
}

export interface NacosAdminConfigListResponse {
  success: boolean;
  data: {
    configs: NacosAdminConfigMeta[];
    canCreateCustom: boolean;
    defaultGroup: string;
  };
  error?: string;
}

export interface NacosAdminConfigDetail {
  dataId: string;
  group: string;
  tenant: string | null;
  type: string;
  content: string;
  contentSha256: string;
  contentLength: number;
  publicReadable: boolean;
  permissions: string[];
}

export interface NacosAdminConfigDetailResponse {
  success: boolean;
  data: NacosAdminConfigDetail;
  error?: string;
}

export interface NacosAdminConfigMutationResponse {
  success: boolean;
  data?: {
    dataId: string;
    group: string;
    tenant: string | null;
    type?: string;
    published?: boolean;
    deleted?: boolean;
    beforeSha256?: string | null;
    afterSha256?: string;
    changed?: boolean;
  };
  error?: string;
}


export interface NacosNativeHistoryItem {
  id: string;
  lastId: number | null;
  dataId: string;
  group: string;
  tenant: string | null;
  appName: string;
  md5: string | null;
  content?: string;
  contentSha256: string | null;
  contentLength: number | null;
  srcIp: string;
  srcUser: string;
  opType: string;
  createdTime: number | string | null;
  lastModifiedTime: number | string | null;
  source: string;
}

export interface NacosNativeHistoryResponse {
  success: boolean;
  data: {
    source: string;
    totalCount: number;
    pageNumber: number;
    pagesAvailable: number;
    pageItems: NacosNativeHistoryItem[];
  };
  error?: string;
}

export interface NacosNativeHistoryDetailResponse {
  success: boolean;
  data: NacosNativeHistoryItem;
  error?: string;
}

export interface NacosAdminConfigSnapshot {
  id: number;
  dataId: string;
  group: string;
  tenant: string | null;
  type: string;
  contentSha256: string;
  contentLength: number;
  action: string;
  reason: string;
  operatorId: number | null;
  operatorEmail: string;
  createdAt: string;
  updatedAt: string;
  content?: string;
}

export interface NacosAdminConfigHistoryResponse {
  success: boolean;
  data: NacosAdminConfigSnapshot[];
  error?: string;
}

export interface NacosAdminConfigHistoryDetailResponse {
  success: boolean;
  data: NacosAdminConfigSnapshot;
  error?: string;
}
