export type MarkerColorPreset =
  | 'danger-red'
  | 'warning-orange'
  | 'info-blue'
  | 'success-green'
  | 'purple-special'
  | 'gold-amber'
  | 'neutral-gray';

export type MarkerVariant = 'subtle' | 'solid' | 'outline' | 'glow';

export type MarkerIcon =
  | 'none'
  | 'shield-alert'
  | 'alert-triangle'
  | 'shield-check'
  | 'badge-check'
  | 'skull'
  | 'flame'
  | 'crown'
  | 'bot'
  | 'ban'
  | 'zap';

export type MarkerEffect = 'none' | 'pulse';

export type MarkerVisibleScope = 'all' | 'whitelist';

export interface SpecialMarkerItem {
  id: number;
  username: string;
  twitterId: string | null;
  markerText: string;
  colorPreset: MarkerColorPreset;
  variant: MarkerVariant;
  icon: MarkerIcon;
  effect: MarkerEffect;
  customTextColor: string | null;
  customBgColor: string | null;
  description: string | null;
  linkUrl: string | null;
  visibleScope: MarkerVisibleScope;
  visibleTwids: string[];
  enabled: boolean;
  operatorId: number | null;
  operatorEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpecialMarkersResponse {
  success: boolean;
  data: SpecialMarkerItem[];
}

export interface SpecialMarkerMutationResponse {
  success: boolean;
  data: SpecialMarkerItem;
}

export interface SpecialMarkerBatchResponse {
  success: boolean;
  data: {
    count: number;
  };
}

export interface ResolveTwidResponse {
  success: boolean;
  data?: {
    username: string;
    twid: string;
  };
  error?: string;
}
