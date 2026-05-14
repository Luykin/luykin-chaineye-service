export interface FeatureFlagsConfig {
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
  username: string;
}

export interface VipListsResponse {
  success: boolean;
  data: {
    vip: VipListItem[];
    internalTest: VipListItem[];
  };
}
