import { apiRequest } from "./apiClient";

export interface AdminUserItem {
  id: number;
  email: string;
  role: "admin" | "super";
  receivesDailyReport: boolean;
  isActive: boolean;
  canLogin: boolean;
  lastLoginAt?: string | null;
  permissions?: string[];
  webauthnCount?: number;
}

export function fetchAdminUsers() {
  return apiRequest<{ success: boolean; data: AdminUserItem[] }>("/admin/users");
}

export function createAdminUser(payload: { email: string; password: string; role: "admin" | "super"; permissions: string[] }) {
  return apiRequest<{ success: boolean; data: AdminUserItem }>("/admin/users", {
    method: "POST",
    body: payload,
  });
}

export function updateAdminDailyReport(id: number, receivesDailyReport: boolean) {
  return apiRequest<{ success: boolean; data: Pick<AdminUserItem, "id" | "receivesDailyReport"> }>(`/admin/users/${id}`, {
    method: "PATCH",
    body: { receivesDailyReport },
  });
}

export function updateAdminPermissions(id: number, permissions: string[]) {
  return apiRequest<{ success: boolean; data: Pick<AdminUserItem, "id" | "permissions"> }>(`/admin/users/${id}/permissions`, {
    method: "PATCH",
    body: { permissions },
  });
}

export function resetAdminRandomPassword(id: number) {
  return apiRequest<{ success: boolean; data: Pick<AdminUserItem, "id" | "email"> & { password: string } }>(
    `/admin/users/${id}/password/reset-random`,
    { method: "POST" },
  );
}
