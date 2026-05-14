import { apiRequest } from "./apiClient";
import type {
  FeatureFlagsPublishResponse,
  FeatureFlagsResponse,
  VipListsResponse,
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
