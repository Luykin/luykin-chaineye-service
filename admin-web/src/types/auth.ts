export type AdminRole = "super" | "admin";

export interface AdminSessionUser {
  id: number;
  email: string;
  role: AdminRole;
  permissions: string[];
  receivesDailyReport: boolean;
  isActive: boolean;
  canLogin: boolean;
  lastLoginAt: string | null;
}

export interface AdminSessionResponse {
  success: boolean;
  loggedIn: boolean;
  admin: AdminSessionUser;
}
