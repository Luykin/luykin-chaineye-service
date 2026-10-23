import { apiRequest } from "./apiClient";

export interface AdminAuthenticatorStatus {
  enrolled: boolean;
  enabledAt: string | null;
}

export interface AdminAuthenticatorSetup {
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}

export function fetchAdminAuthenticatorStatus() {
  return apiRequest<{ success: boolean; data: AdminAuthenticatorStatus }>(`/admin/totp/status?_ts=${Date.now()}`);
}

export function beginAdminAuthenticatorSetup() {
  return apiRequest<{ success: boolean; data: AdminAuthenticatorSetup }>("/admin/totp/setup", {
    method: "POST",
  });
}

export function verifyAdminAuthenticatorSetup(code: string) {
  return apiRequest<{
    success: boolean;
    data: { enrolled: boolean; verified: boolean; expiresInSeconds: number };
  }>("/admin/totp/setup/verify", {
    method: "POST",
    body: { code },
  });
}
