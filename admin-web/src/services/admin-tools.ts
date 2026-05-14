import { apiRequest } from "./apiClient";
import type { SendMessagesResponse, ServerCommandResponse } from "@/types/admin-tools";

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
