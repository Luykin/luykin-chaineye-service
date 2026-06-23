import { apiRequest } from "./apiClient";
import type {
  AdBannerConfig,
  FeatureFlagsPublishResponse,
  FeatureFlagsResponse,
  VipListsResponse,
  VipTwitterIdSyncResponse,
} from "@/types/feature-flags";

export async function fetchFeatureFlagsConfig() {
  return apiRequest<FeatureFlagsResponse>("/api/xhunt/stats/feature-flags");
}

export async function publishFeatureFlagsConfig(content: string) {
  return apiRequest<FeatureFlagsPublishResponse>("/api/xhunt/stats/feature-flags", {
    method: "POST",
    body: { content },
  });
}

export async function fetchBannerConfig() {
  return apiRequest<{
    success: boolean;
    data: {
      dataId: string;
      group: string;
      adBanners: AdBannerConfig[];
      featureSlots: AdBannerConfig[];
    };
  }>("/api/xhunt/stats/banner-config");
}

export async function publishBannerConfig(adBanners: AdBannerConfig[]) {
  return apiRequest<FeatureFlagsPublishResponse>("/api/xhunt/stats/banner-config", {
    method: "POST",
    body: { adBanners },
  });
}

export async function fetchVipLists() {
  return apiRequest<VipListsResponse>("/api/xhunt/stats/vip-lists");
}

export async function fetchFeatureTranslations() {
  const response = await fetch(
    "https://kb.cryptohunt.ai/nacos-configs?dataId=xhunt_i18n&group=DEFAULT_GROUP"
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<{ zh?: Record<string, string> }>;
}

export async function addVipListUser(listType: "vip" | "internal_test", username: string) {
  return apiRequest<{ success: boolean; data?: unknown; error?: string }>("/api/xhunt/stats/vip-lists/add", {
    method: "POST",
    body: { listType, username },
  });
}

export async function deleteVipListUser(id: number) {
  return apiRequest<{ success: boolean; error?: string }>(`/api/xhunt/stats/vip-lists/${id}`, {
    method: "DELETE",
  });
}

export async function syncVipTwitterIds(force = true) {
  return apiRequest<VipTwitterIdSyncResponse>("/api/xhunt/stats/vip-lists/sync-twitter-ids", {
    method: "POST",
    body: { force },
  });
}

export async function becomeCreator(id: number) {
  return apiRequest<{ success: boolean; data?: unknown; error?: string }>(
    `/api/xhunt/stats/vip-lists/${id}/become-creator`,
    {
      method: "POST",
    }
  );
}
