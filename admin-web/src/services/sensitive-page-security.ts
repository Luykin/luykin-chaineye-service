import { apiRequest } from "./apiClient";

export type SensitivePageTotpScope = "server-command" | "log-search" | "nacos-admin";

export interface SensitivePageTotpStatus {
  enrolled: boolean;
  verified: boolean;
  ttlSeconds: number;
  expiresInSeconds: number;
}

export interface SensitivePageTotpSetup {
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}

const BASE_PATH = "/api/xhunt/stats/sensitive-totp";

export function fetchSensitivePageTotpStatus(scope: SensitivePageTotpScope) {
  return apiRequest<{ success: boolean; data: SensitivePageTotpStatus }>(
    `${BASE_PATH}/${scope}/status?_ts=${Date.now()}`,
  );
}

export function beginSensitivePageTotpSetup(scope: SensitivePageTotpScope) {
  return apiRequest<{ success: boolean; data: SensitivePageTotpSetup }>(`${BASE_PATH}/${scope}/setup`, {
    method: "POST",
  });
}

export function verifySensitivePageTotpSetup(scope: SensitivePageTotpScope, code: string) {
  return apiRequest<{
    success: boolean;
    data: { enrolled: boolean; verified: boolean; expiresInSeconds: number };
  }>(`${BASE_PATH}/${scope}/setup/verify`, {
    method: "POST",
    body: { code },
  });
}

export function verifySensitivePageTotp(scope: SensitivePageTotpScope, code: string) {
  return apiRequest<{ success: boolean; data: { verified: boolean; expiresInSeconds: number } }>(`${BASE_PATH}/${scope}/verify`, {
    method: "POST",
    body: { code },
  });
}
