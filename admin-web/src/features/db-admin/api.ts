import { apiRequest } from "@/services/apiClient";
import type {
  ApiSuccess,
  DbAdminDatabasesData,
  DbAdminRowsData,
  DbAdminTableMeta,
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
