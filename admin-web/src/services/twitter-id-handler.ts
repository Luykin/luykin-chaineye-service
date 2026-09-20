import { apiRequest } from "./apiClient";
import type { TwitterIdHandlerLookupResponse } from "@/types/twitter-id-handler";

export function lookupTwitterIdHandler(params: { twitterId?: string; handler?: string }) {
  const query = new URLSearchParams();
  if (params.twitterId?.trim()) query.set("twitterId", params.twitterId.trim());
  if (params.handler?.trim()) query.set("handler", params.handler.trim().replace(/^@+/, ""));
  return apiRequest<TwitterIdHandlerLookupResponse>(`/api/xhunt/stats/twitter-id-handler-lookup?${query.toString()}`);
}
