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
