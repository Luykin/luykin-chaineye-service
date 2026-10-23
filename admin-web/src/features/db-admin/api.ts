import { ApiError, apiRequest, buildApiUrl } from "@/services/apiClient";
import type {
  DbAdminAccessManagementData,
  ApiSuccess,
  DbAdminDatabasesData,
  DbAdminRowsData,
  DbAdminTableMeta,
  DbAdminTotpSetupData,
  DbAdminWebAuthnOptionsResponse,
  DbAdminWebAuthnStatus,
} from "./types";

const BASE_PATH = "/admin/db-admin";

export function fetchDbAdminDatabases() {
  return apiRequest<ApiSuccess<DbAdminDatabasesData>>(`${BASE_PATH}/databases`);
}

export function saveDbAdminCredentials(dbKey: string, payload: { username: string; password: string }) {
  return apiRequest<ApiSuccess<{ database: string; username: string; connected: boolean }>>(
    `${BASE_PATH}/databases/${encodeURIComponent(dbKey)}/credentials`,
    {
      method: "POST",
      body: payload,
    }
  );
}

export function fetchDbAdminTables(db?: string) {
  const searchParams = new URLSearchParams();
  if (db) searchParams.set("db", db);
  const query = searchParams.toString();
  return apiRequest<ApiSuccess<DbAdminTableMeta[]>>(`${BASE_PATH}/tables${query ? `?${query}` : ""}`);
}

export function fetchDbAdminSchema(tableKey: string, db?: string) {
  const searchParams = new URLSearchParams();
  if (db) searchParams.set("db", db);
  const query = searchParams.toString();
  return apiRequest<ApiSuccess<DbAdminTableMeta>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/schema${query ? `?${query}` : ""}`
  );
}

export function fetchDbAdminRows(
  tableKey: string,
  params: { db?: string; page: number; pageSize: number; q?: string; sortBy?: string; sortOrder?: "ASC" | "DESC" }
) {
  const searchParams = new URLSearchParams();
  if (params.db) searchParams.set("db", params.db);
  searchParams.set("page", String(params.page));
  searchParams.set("pageSize", String(params.pageSize));
  if (params.q) searchParams.set("q", params.q);
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.sortOrder) searchParams.set("sortOrder", params.sortOrder);
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows?${searchParams.toString()}`
  );
}

export function createDbAdminRow(tableKey: string, values: Record<string, unknown>, db?: string) {
  const searchParams = new URLSearchParams();
  if (db) searchParams.set("db", db);
  const query = searchParams.toString();
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows${query ? `?${query}` : ""}`,
    {
      method: "POST",
      body: values,
    }
  );
}

export function updateDbAdminRow(tableKey: string, id: string | number, values: Record<string, unknown>, db?: string) {
  const searchParams = new URLSearchParams();
  if (db) searchParams.set("db", db);
  const query = searchParams.toString();
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows/${encodeURIComponent(String(id))}${query ? `?${query}` : ""}`,
    {
      method: "PATCH",
      body: values,
    }
  );
}

export function deleteDbAdminRow(tableKey: string, id: string | number, db?: string) {
  const searchParams = new URLSearchParams();
  if (db) searchParams.set("db", db);
  const query = searchParams.toString();
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows/${encodeURIComponent(String(id))}${query ? `?${query}` : ""}`,
    {
      method: "DELETE",
    }
  );
}

function parseDownloadFilename(contentDisposition: string | null, fallback: string) {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch (_) {}
  }
  const plain = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  return plain || fallback;
}

export async function exportDbAdminRows(
  tableKey: string,
  params: { db?: string; q?: string; sortBy?: string; sortOrder?: "ASC" | "DESC" }
) {
  const searchParams = new URLSearchParams();
  if (params.db) searchParams.set("db", params.db);
  if (params.q) searchParams.set("q", params.q);
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.sortOrder) searchParams.set("sortOrder", params.sortOrder);
  const response = await fetch(buildApiUrl(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/export?${searchParams.toString()}`
  ), {
    credentials: "include",
    headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json" },
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const data: unknown = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);
    const message = typeof data === "object" && data && "error" in data
      ? String((data as { error?: string }).error || "导出失败")
      : `导出失败 (${response.status})`;
    throw new ApiError(message, response.status, data);
  }
  return {
    blob: await response.blob(),
    filename: parseDownloadFilename(response.headers.get("content-disposition"), `${tableKey}.xlsx`),
  };
}

export function fetchDbAdminAccessGrants() {
  return apiRequest<ApiSuccess<DbAdminAccessManagementData>>(`${BASE_PATH}/access-grants`);
}

export function grantDbAdminTableAccess(payload: { adminId: number; databaseKey: string; tableKey: string }) {
  return apiRequest<ApiSuccess<{ id: number; created: boolean }>>(`${BASE_PATH}/access-grants`, {
    method: "POST",
    body: payload,
  });
}

export function revokeDbAdminTableAccess(grantId: number) {
  return apiRequest<ApiSuccess<{ id: number }>>(`${BASE_PATH}/access-grants/${grantId}`, {
    method: "DELETE",
  });
}


export function fetchDbAdminWebAuthnStatus() {
  return apiRequest<ApiSuccess<DbAdminWebAuthnStatus>>(`${BASE_PATH}/webauthn/status?_ts=${Date.now()}`);
}

export function fetchDbAdminWebAuthnOptions() {
  return apiRequest<DbAdminWebAuthnOptionsResponse>(`${BASE_PATH}/webauthn/options?_ts=${Date.now()}`);
}

export function verifyDbAdminWebAuthn(assertion: unknown) {
  return apiRequest<ApiSuccess<{ verified: boolean; expiresInSeconds: number }>>(`${BASE_PATH}/webauthn/verify`, {
    method: "POST",
    body: { assertion },
  });
}

export function beginDbAdminTotpSetup() {
  return apiRequest<ApiSuccess<DbAdminTotpSetupData>>(`${BASE_PATH}/totp/setup`, {
    method: "POST",
  });
}

export function verifyDbAdminTotpSetup(code: string) {
  return apiRequest<ApiSuccess<{ enrolled: boolean; verified: boolean; expiresInSeconds: number }>>(
    `${BASE_PATH}/totp/setup/verify`,
    { method: "POST", body: { code } },
  );
}

export function verifyDbAdminTotp(code: string) {
  return apiRequest<ApiSuccess<{ verified: boolean; expiresInSeconds: number }>>(`${BASE_PATH}/totp/verify`, {
    method: "POST",
    body: { code },
  });
}
