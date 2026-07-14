import { apiRequest } from "./apiClient";
import type { CreatorAuthQueryResponse, SendMessagesResponse, ServerCommandResponse, UserPrivateMessagesResponse } from "@/types/admin-tools";

export async function executeServerCommand(command: string) {
  return apiRequest<ServerCommandResponse>("/api/xhunt/stats/execute-command", {
    method: "POST",
    body: { command },
  });
}

export async function sendBatchMessages(params: {
  campaignId: string;
  title: string;
  content: string;
  handlers: string[];
  reportUrls?: string[];
}) {
  return apiRequest<SendMessagesResponse>("/api/xhunt/stats/send-messages", {
    method: "POST",
    body: params,
  });
}

export async function fetchCreatorAuth(username: string) {
  const query = new URLSearchParams();
  query.set("username", username);
  return apiRequest<CreatorAuthQueryResponse>(`/api/xhunt/stats/vip-lists/creator-auth?${query.toString()}`);
}

export async function fetchUserPrivateMessages(params: {
  identifier: string;
  campaignId?: string;
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("identifier", params.identifier);
  query.set("page", String(params.page || 1));
  query.set("limit", String(params.limit || 20));
  if (params.campaignId?.trim()) query.set("campaignId", params.campaignId.trim());
  return apiRequest<UserPrivateMessagesResponse>(`/api/xhunt/stats/user-lookup/private-messages?${query.toString()}`);
}
