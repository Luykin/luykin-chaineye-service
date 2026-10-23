import { apiRequest } from "./apiClient";

export interface AdminUserItem {
  id: number;
  email: string;
  role: "admin" | "super";
  receivesDailyReport: boolean;
  isActive: boolean;
  canLogin: boolean;
  failedLoginAttempts?: number;
  loginLockedUntil?: string | null;
  lastLoginAt?: string | null;
  permissions?: string[];
  webauthnCount?: number;
}

export interface AdminUsersSecurityStatus {
  webauthn: { enrolled: boolean; verified: boolean; ttlSeconds: number };
  totp: { enrolled: boolean; verified: boolean; ttlSeconds: number };
  verified: boolean;
  expiresInSeconds: number;
}

export interface TotpSetupData {
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}

export function fetchAdminUsersSecurityStatus() {
  return apiRequest<{ success: boolean; data: AdminUsersSecurityStatus }>(`/admin/users/security/status?_ts=${Date.now()}`);
}

export function fetchAdminUsersWebAuthnOptions() {
  return apiRequest<{ success: boolean; options: unknown }>(`/admin/users/security/webauthn/options?_ts=${Date.now()}`);
}

export function verifyAdminUsersWebAuthn(assertion: unknown) {
  return apiRequest<{ success: boolean; data: { verified: boolean; expiresInSeconds: number } }>(
    "/admin/users/security/webauthn/verify",
    { method: "POST", body: { assertion } },
  );
}

export function fetchAdminWebAuthnRegistrationOptions() {
  return apiRequest<{ success: boolean; options: unknown }>(`/admin/webauthn/registration/options?_ts=${Date.now()}`);
}

export function verifyAdminWebAuthnRegistration(attResp: unknown, nickname: string) {
  return apiRequest<{ success: boolean }>("/admin/webauthn/registration/verify", {
    method: "POST",
    body: { attResp, nickname },
  });
}

export function beginAdminUsersTotpSetup() {
  return apiRequest<{ success: boolean; data: TotpSetupData }>("/admin/users/security/totp/setup", {
    method: "POST",
  });
}

export function verifyAdminUsersTotpSetup(code: string) {
  return apiRequest<{ success: boolean; data: { enrolled: boolean; verified: boolean; expiresInSeconds: number } }>(
    "/admin/users/security/totp/setup/verify",
    { method: "POST", body: { code } },
  );
}

export function verifyAdminUsersTotp(code: string) {
  return apiRequest<{ success: boolean; data: { verified: boolean; expiresInSeconds: number } }>(
    "/admin/users/security/totp/verify",
    { method: "POST", body: { code } },
  );
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

export function updateAdminActiveStatus(id: number, isActive: boolean) {
  return apiRequest<{ success: boolean; data: Pick<AdminUserItem, "id" | "email" | "isActive" | "canLogin"> }>(`/admin/users/${id}/active`, {
    method: "PATCH",
    body: { isActive },
  });
}

export function deleteAdminUser(id: number) {
  return apiRequest<{ success: boolean; data: Pick<AdminUserItem, "id" | "email"> }>(`/admin/users/${id}`, {
    method: "DELETE",
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

export function unlockAdminUser(id: number) {
  return apiRequest<{ success: boolean; data: Pick<AdminUserItem, "id" | "email" | "canLogin" | "failedLoginAttempts" | "loginLockedUntil"> }>(
    `/admin/users/${id}/unlock`,
    { method: "POST" },
  );
}
