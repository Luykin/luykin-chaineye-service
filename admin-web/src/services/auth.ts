import { apiRequest } from "./apiClient";
import type { AdminSessionResponse } from "@/types/auth";

export async function fetchAdminSession() {
  return apiRequest<AdminSessionResponse>("/admin/session");
}
