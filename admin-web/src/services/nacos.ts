import { apiRequest } from "./apiClient";
import type {
  NacosConfigResponse,
  NacosPublishResponse,
  WebsiteCampaignListResponse,
  WebsiteCampaignSyncResponse,
} from "@/types/nacos";

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
