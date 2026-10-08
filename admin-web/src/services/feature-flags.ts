import { apiRequest } from "./apiClient";
import type {
  AdBannerConfig,
  FeatureFlagsPublishResponse,
  FeatureFlagsResponse,
  VipListItem,
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
  return apiRequest<{ zh?: Record<string, string> }>("/api/xhunt/stats/feature-flags/translations");
}

export async function addVipListUser(
  listType: "vip" | "internal_test",
  username: string,
  twitterId?: string | null
) {
  return apiRequest<{ success: boolean; data?: unknown; error?: string }>("/api/xhunt/stats/vip-lists/add", {
    method: "POST",
    body: {
      listType,
      username,
      twitterId: twitterId ? twitterId.trim() : undefined,
    },
  });
}

export async function updateVipTwitterId(id: number, twitterId: string | null) {
  return apiRequest<{ success: boolean; data?: VipListItem; error?: string }>(
    `/api/xhunt/stats/vip-lists/${id}/twitter-id`,
    {
      method: "PUT",
      body: { twitterId },
    }
  );
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
