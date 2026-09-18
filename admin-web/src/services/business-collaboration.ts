import { apiRequest } from "./apiClient";

export type CollaborationActivityStatus = "draft" | "open" | "paused" | "archived";
export interface CollaborationAccess { id: string; authCenterUserId: string; twitterId?: string | null; role: "project_manager" | "agency_manager"; status: "active" | "paused" | "revoked"; reason?: string | null; user?: { accountName?: string | null; displayName?: string | null; primaryTwitterId?: string | null } | null; }
export interface CollaborationActivity { id: string; name: string; description?: string | null; projectTwitterId: string; projectTwitterHandle?: string | null; projectDisplayName?: string | null; fundingPoolAmount: string; currency: string; availableAmount: string; reservedAmount: string; lockedAmount: string; claimableAmount: string; paidAmount: string; seatLimit: number; startAt: string; endAt: string; reviewerMode: "echohunt" | "project"; status: CollaborationActivityStatus; invitationTemplate: Record<string, unknown>; accesses?: CollaborationAccess[]; }
export interface CollaborationProjectAccount { twitterId: string; handle: string; displayName?: string | null; avatar?: string | null; followers?: number; }
export interface CollaborationInternalTestUser { authCenterUserId?: string | null; username: string; twitterId?: string | null; }

const apiBase = "/api/admin/business-collaboration";
const base = `${apiBase}/activities`;
export const fetchCollaborationActivities = () => apiRequest<{ success: boolean; data: CollaborationActivity[] }>(base);
export const lookupCollaborationProjectAccount = (handle: string) => apiRequest<{ success: boolean; data: CollaborationProjectAccount }>(`${apiBase}/project-account?handle=${encodeURIComponent(handle)}`);
export const fetchCollaborationInternalTestUsers = () => apiRequest<{ success: boolean; data: CollaborationInternalTestUser[] }>(`${apiBase}/internal-test-users`);
export const createCollaborationActivity = (body: Partial<CollaborationActivity>) => apiRequest<{ success: boolean; data: CollaborationActivity }>(base, { method: "POST", body });
export const updateCollaborationActivity = (id: string, body: Partial<CollaborationActivity>) => apiRequest<{ success: boolean; data: CollaborationActivity }>(`${base}/${id}`, { method: "PATCH", body });
export const deleteCollaborationActivity = (id: string) => apiRequest<{ success: boolean }>(`${base}/${id}`, { method: "DELETE" });
export const grantCollaborationAccess = (id: string, body: { authCenterUserId: string; role: "project_manager" | "agency_manager"; reason?: string }) => apiRequest<{ success: boolean; data: CollaborationAccess }>(`${base}/${id}/accesses`, { method: "POST", body });
export const updateCollaborationAccess = (activityId: string, accessId: string, body: { status: "active" | "paused" | "revoked"; reason?: string }) => apiRequest<{ success: boolean; data: CollaborationAccess }>(`${base}/${activityId}/accesses/${accessId}`, { method: "PATCH", body });
