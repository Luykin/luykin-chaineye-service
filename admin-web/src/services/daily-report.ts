import { apiRequest } from "./apiClient";

export function sendDailyReport(recipients?: string[]) {
  return apiRequest<{ success: boolean; data?: unknown; error?: string }>("/api/xhunt/stats/report/send", {
    method: "POST",
    body: { recipients: recipients && recipients.length ? recipients : undefined },
  });
}
