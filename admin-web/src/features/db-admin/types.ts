export interface DbAdminColumn {
  name: string;
  dataType: string;
  udtName?: string | null;
  nullable: boolean;
  defaultValue?: string | null;
  maxLength?: number | null;
  numericPrecision?: number | null;
  numericScale?: number | null;
  ordinalPosition: number;
  comment?: string | null;
  hidden: boolean;
  readonly: boolean;
  primaryKey: boolean;
  enumOptions?: string[] | null;
}

export interface DbAdminTableMeta {
  key: string;
  label: string;
  description?: string;
  table: string;
  primaryKey: string | null;
  hasSinglePrimaryKey?: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  searchableColumns: string[];
  columns?: DbAdminColumn[];
}

export interface DbAdminDatabaseOption {
  key: string;
  name: string;
  label: string;
  description?: string;
  configurableCredentials?: boolean;
  readOnly?: boolean;
  schema?: string;
  username?: string;
  hasPasswordConfigured?: boolean;
}

export interface DbAdminDatabasesData {
  defaultDatabase: string;
  databases: DbAdminDatabaseOption[];
}

export type DbAdminRow = Record<string, unknown>;

export interface DbAdminPagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface DbAdminRowsData {
  table: DbAdminTableMeta;
  rows: DbAdminRow[];
  pagination: DbAdminPagination;
}

export interface DbAdminGrantAdmin {
  id: number;
  email: string;
  role?: "admin" | "super";
  isActive: boolean;
  canLogin: boolean;
}

export interface DbAdminTableGrant {
  id: number;
  adminId: number;
  databaseKey: string;
  tableKey: string;
  grantedByAdminId?: number | null;
  createdAt: string;
  admin?: DbAdminGrantAdmin | null;
  grantedByAdmin?: Pick<DbAdminGrantAdmin, "id" | "email"> | null;
}

export interface DbAdminAccessManagementData {
  admins: DbAdminGrantAdmin[];
  grants: DbAdminTableGrant[];
}

export interface ApiSuccess<T> {
  success: boolean;
  data: T;
}

export interface DbAdminWebAuthnStatus {
  enrolled: boolean;
  verified: boolean;
  ttlSeconds: number;
  expiresInSeconds: number;
}

export interface DbAdminWebAuthnOptionsResponse {
  success: boolean;
  options: unknown;
}
