import { apiRequest } from "./apiClient";
import type {
  NacosConfigResponse,
  NacosPublishResponse,
  NacosI18nReferenceResponse,
  WebsiteCampaignListResponse,
  WebsiteCampaignSyncResponse,
  CampaignRegistrationListResponse,
} from "@/types/nacos";


export async function fetchNacosI18nReference() {
  return apiRequest<NacosI18nReferenceResponse>("/api/xhunt/stats/nacos/i18n/reference");
}

export async function fetchNacosConfig(params: {
  dataId: string;
  group?: string;
  tenant?: string;
}) {
  const query = new URLSearchParams();
  query.set("dataId", params.dataId);
  query.set("group", params.group || "DEFAULT_GROUP");
  if (params.tenant) query.set("tenant", params.tenant);
  return apiRequest<NacosConfigResponse>(`/api/xhunt/stats/nacos/config?${query.toString()}`);
}

export async function publishNacosConfig(params: {
  dataId: string;
  content: string;
  group?: string;
  tenant?: string;
  type?: string;
  source?: string;
}) {
  return apiRequest<NacosPublishResponse>("/api/xhunt/stats/nacos/config", {
    method: "POST",
    body: {
      dataId: params.dataId,
      group: params.group || "DEFAULT_GROUP",
      tenant: params.tenant,
      content: params.content,
      type: params.type || "json",
      source: params.source,
    },
  });
}

export async function syncWebsiteCampaignsFromNacos(dryRun = false) {
  return apiRequest<WebsiteCampaignSyncResponse>("/api/xhunt/website/campaigns/internal/sync-from-nacos", {
    method: "POST",
    body: { dryRun },
  });
}

export async function fetchAllWebsiteCampaigns() {
  return apiRequest<WebsiteCampaignListResponse>("/api/xhunt/website/campaigns/internal/list-all");
}

export async function fetchWebsiteCampaignByNacosId(nacosCampaignId: string) {
  return apiRequest<{ success: boolean; data: WebsiteCampaignListResponse["data"][number] | null }>(
    `/api/xhunt/website/campaigns/internal/by-nacos-id/${encodeURIComponent(nacosCampaignId)}`
  );
}

export async function saveWebsiteCampaignConfig(nacosCampaignId: string, payload: Record<string, unknown>) {
  return apiRequest<{ success: boolean; data?: unknown; error?: string }>(
    `/api/xhunt/website/campaigns/internal/${encodeURIComponent(nacosCampaignId)}/web-config`,
    {
      method: "PUT",
      body: payload,
    }
  );
}

export async function saveManagedWebsiteCampaignsConfig(payload: Record<string, unknown>) {
  return apiRequest<{ success: boolean; summary?: Record<string, number>; error?: string }>(
    "/api/xhunt/website/campaigns/internal/managed-config",
    {
      method: "PUT",
      body: payload,
    }
  );
}

export async function fetchCampaignRegistrationsAdmin(params: {
  campaign: string;
  page?: number;
  pageSize?: number;
  twitterId?: string;
  username?: string;
}) {
  const query = new URLSearchParams();
  query.set("campaign", params.campaign);
  query.set("page", String(params.page || 1));
  query.set("pageSize", String(params.pageSize || 20));
  if (params.twitterId?.trim()) query.set("twitterId", params.twitterId.trim());
  if (params.username?.trim()) query.set("username", params.username.trim());
  return apiRequest<CampaignRegistrationListResponse>(`/api/xhunt/campaigns/internal/registrations?${query.toString()}`);
}

export async function deleteCampaignRegistrationAdmin(id: string, campaign?: string) {
  const query = new URLSearchParams();
  if (campaign?.trim()) query.set("campaign", campaign.trim());
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<{ success: boolean; data?: unknown; error?: string }>(
    `/api/xhunt/campaigns/internal/registrations/${encodeURIComponent(id)}${suffix}`,
    { method: "DELETE" }
  );
}

export async function fetchUserTags() {
  return apiRequest<import("@/types/nacos").UserTagsResponse>("/api/xhunt/stats/user-tags");
}

export async function upsertUserTag(payload: {
  id?: number;
  username: string;
  twitterId?: string | null;
  tagsZh: string[];
  tagsEn: string[];
}) {
  return apiRequest<import("@/types/nacos").UserTagMutationResponse>("/api/xhunt/stats/user-tags/upsert", {
    method: "POST",
    body: payload,
  });
}

export async function deleteUserTag(id: number) {
  return apiRequest<{ success: boolean; error?: string }>(`/api/xhunt/stats/user-tags/${id}`, {
    method: "DELETE",
  });
}

export async function syncUserTagTwitterIds(force = true) {
  return apiRequest<import("@/types/nacos").UserTagSyncResponse>("/api/xhunt/stats/user-tags/sync-twitter-ids", {
    method: "POST",
    body: { force },
  });
}

export async function importUserTagsFromNacos(overwrite = false) {
  return apiRequest<import("@/types/nacos").UserTagSyncResponse>("/api/xhunt/stats/user-tags/import-from-nacos", {
    method: "POST",
    body: { overwrite },
  });
}
