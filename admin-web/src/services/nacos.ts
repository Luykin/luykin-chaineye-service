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

export type EchohuntDebugTokenUser = {
  id: string;
  authCenterUserId?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  accountName?: string | null;
  providers?: string[];
  xhuntUserId?: string | null;
  twitterId?: string | null;
  twitterUsername?: string | null;
  status?: string;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

export type EchohuntDebugTokenPayload = {
  storageKey: string;
  storageValue: {
    token: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      tokenType: string;
    };
    user: Record<string, unknown>;
  };
  expiresAt: string;
  ttlSeconds: number;
};

export async function searchEchohuntDebugTokenUsers(keyword: string) {
  const query = new URLSearchParams();
  if (keyword.trim()) query.set("keyword", keyword.trim());
  return apiRequest<{ success: boolean; data: EchohuntDebugTokenUser[] }>(
    `/api/xhunt/website/campaigns/internal/echohunt-token/users?${query.toString()}`
  );
}

export async function generateEchohuntDebugToken(userId: string) {
  return apiRequest<{ success: boolean; data: EchohuntDebugTokenPayload }>(
    "/api/xhunt/website/campaigns/internal/echohunt-token/generate",
    {
      method: "POST",
      body: { xhuntUserId: userId },
    }
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

export async function runNacosSecurityCheck() {
  return apiRequest<import("@/types/nacos").NacosSecurityCheckResponse>("/api/xhunt/stats/security/nacos/check", {
    method: "POST",
    body: {},
  });
}

export async function fetchNacosAdminConfigs() {
  return apiRequest<import("@/types/nacos").NacosAdminConfigListResponse>("/api/xhunt/stats/nacos/admin/configs");
}

export async function fetchNacosAdminConfig(params: { dataId: string; group?: string; tenant?: string }) {
  const query = new URLSearchParams();
  query.set("dataId", params.dataId);
  query.set("group", params.group || "DEFAULT_GROUP");
  if (params.tenant) query.set("tenant", params.tenant);
  return apiRequest<import("@/types/nacos").NacosAdminConfigDetailResponse>(`/api/xhunt/stats/nacos/admin/config?${query.toString()}`);
}

export async function publishNacosAdminConfig(params: {
  dataId: string;
  group?: string;
  tenant?: string;
  type?: string;
  content: string;
  reason?: string;
}) {
  return apiRequest<import("@/types/nacos").NacosAdminConfigMutationResponse>("/api/xhunt/stats/nacos/admin/config", {
    method: "POST",
    body: {
      dataId: params.dataId,
      group: params.group || "DEFAULT_GROUP",
      tenant: params.tenant,
      type: params.type || "json",
      content: params.content,
      reason: params.reason,
    },
  });
}

export async function deleteNacosAdminConfig(params: { dataId: string; group?: string; tenant?: string; reason?: string }) {
  const query = new URLSearchParams();
  query.set("dataId", params.dataId);
  query.set("group", params.group || "DEFAULT_GROUP");
  if (params.tenant) query.set("tenant", params.tenant);
  if (params.reason) query.set("reason", params.reason);
  return apiRequest<import("@/types/nacos").NacosAdminConfigMutationResponse>(`/api/xhunt/stats/nacos/admin/config?${query.toString()}`, {
    method: "DELETE",
  });
}


export async function fetchNacosAdminNativeHistory(params: { dataId: string; group?: string; tenant?: string; pageNo?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  query.set("dataId", params.dataId);
  query.set("group", params.group || "DEFAULT_GROUP");
  query.set("pageNo", String(params.pageNo || 1));
  query.set("pageSize", String(params.pageSize || 20));
  if (params.tenant) query.set("tenant", params.tenant);
  return apiRequest<import("@/types/nacos").NacosNativeHistoryResponse>(`/api/xhunt/stats/nacos/admin/config/native-history?${query.toString()}`);
}

export async function fetchNacosAdminNativeHistoryDetail(params: { id: string; dataId: string; group?: string; tenant?: string; source?: string }) {
  const query = new URLSearchParams();
  query.set("dataId", params.dataId);
  query.set("group", params.group || "DEFAULT_GROUP");
  if (params.tenant) query.set("tenant", params.tenant);
  if (params.source) query.set("source", params.source);
  return apiRequest<import("@/types/nacos").NacosNativeHistoryDetailResponse>(
    `/api/xhunt/stats/nacos/admin/config/native-history/${encodeURIComponent(params.id)}?${query.toString()}`
  );
}

export async function fetchNacosAdminConfigHistory(params: { dataId: string; group?: string; tenant?: string; limit?: number }) {
  const query = new URLSearchParams();
  query.set("dataId", params.dataId);
  query.set("group", params.group || "DEFAULT_GROUP");
  query.set("limit", String(params.limit || 30));
  if (params.tenant) query.set("tenant", params.tenant);
  return apiRequest<import("@/types/nacos").NacosAdminConfigHistoryResponse>(`/api/xhunt/stats/nacos/admin/config/history?${query.toString()}`);
}

export async function fetchNacosAdminConfigSnapshot(id: number) {
  return apiRequest<import("@/types/nacos").NacosAdminConfigHistoryDetailResponse>(
    `/api/xhunt/stats/nacos/admin/config/history/${encodeURIComponent(String(id))}`
  );
}
