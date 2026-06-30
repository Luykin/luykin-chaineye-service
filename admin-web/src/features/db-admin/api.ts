import { apiRequest } from "@/services/apiClient";
import type { ApiSuccess, DbAdminRowsData, DbAdminTableMeta, DbAdminWebAuthnOptionsResponse, DbAdminWebAuthnStatus } from "./types";

const BASE_PATH = "/admin/db-admin";

export function fetchDbAdminTables() {
  return apiRequest<ApiSuccess<DbAdminTableMeta[]>>(`${BASE_PATH}/tables`);
}

export function fetchDbAdminSchema(tableKey: string) {
  return apiRequest<ApiSuccess<DbAdminTableMeta>>(`${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/schema`);
}

export function fetchDbAdminRows(
  tableKey: string,
  params: { page: number; pageSize: number; q?: string; sortBy?: string; sortOrder?: "ASC" | "DESC" }
) {
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(params.page));
  searchParams.set("pageSize", String(params.pageSize));
  if (params.q) searchParams.set("q", params.q);
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.sortOrder) searchParams.set("sortOrder", params.sortOrder);
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows?${searchParams.toString()}`
  );
}

export function createDbAdminRow(tableKey: string, values: Record<string, unknown>) {
  return apiRequest<ApiSuccess<DbAdminRowsData>>(`${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows`, {
    method: "POST",
    body: values,
  });
}

export function updateDbAdminRow(tableKey: string, id: string | number, values: Record<string, unknown>) {
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows/${encodeURIComponent(String(id))}`,
    {
      method: "PATCH",
      body: values,
    }
  );
}

export function deleteDbAdminRow(tableKey: string, id: string | number) {
  return apiRequest<ApiSuccess<DbAdminRowsData>>(
    `${BASE_PATH}/tables/${encodeURIComponent(tableKey)}/rows/${encodeURIComponent(String(id))}`,
    {
      method: "DELETE",
    }
  );
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
