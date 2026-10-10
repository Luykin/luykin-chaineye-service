import { apiRequest } from "./apiClient";

export type CollaborationActivityStatus = "draft" | "open" | "paused" | "archived";
export interface CollaborationAccess { id: string; authCenterUserId: string; twitterId?: string | null; role: "project_manager" | "agency_manager"; status: "active" | "paused" | "revoked"; reason?: string | null; user?: { accountName?: string | null; displayName?: string | null; primaryTwitterId?: string | null; twitterUsername?: string | null; twitterDisplayName?: string | null; } | null; }
export interface CollaborationActivityStats { invitations: { total: number; pendingResponse: number; accepted: number; confirmed: number; kolDeclined: number; projectDeclined: number; reservationExpired: number; }; collaborations: { confirmed: number; }; kolProgress: { seatLimit: number; reserved: number; confirmed: number; percent: number; }; }
export interface CollaborationActivity { id: string; name: string; description?: string | null; projectTwitterId: string; projectTwitterHandle?: string | null; projectDisplayName?: string | null; projectTwitterAvatarUrl?: string | null; projectTwitterBannerUrl?: string | null; fundingPoolAmount: string; currency: string; availableAmount: string; reservedAmount: string; lockedAmount: string; claimableAmount: string; paidAmount: string; seatLimit: number; startAt: string; endAt: string; reviewerMode: "echohunt" | "project"; status: CollaborationActivityStatus; invitationTemplate: Record<string, unknown>; stats?: CollaborationActivityStats; accesses?: CollaborationAccess[]; }
export interface CollaborationProjectAccount { twitterId: string; handle: string; displayName?: string | null; avatar?: string | null; banner?: string | null; followers?: number; }
export interface CollaborationInternalTestUser { authCenterUserId?: string | null; username: string; twitterId?: string | null; }
export interface CollaborationInvitationOverview { id: string; kol: { twitterId: string; username?: string | null; displayName?: string | null; }; offerAmount: string; currency: string; status: string; acceptedAt?: string | null; reservationExpiresAt?: string | null; declineReason?: string | null; collaboration?: { id: string; status: string; lockedAmount: string; confirmedAt?: string | null; } | null; createdAt: string; updatedAt: string; }
export interface CollaborationActivityOverview { activity: CollaborationActivity; invitations: CollaborationInvitationOverview[]; }
export interface CollaborationReviewRound { id: string; collaborationId: string; roundNumber: number; draftUrl: string; aiStatus: string; aiResult?: { summary?: string; issues?: Array<{ point?: string; detail?: string }> } | null; aiReviewedAt?: string | null; humanStatus: string; humanComment?: string | null; createdAt: string; collaboration?: { id: string; status: string; kolTwitterId: string; lockedAmount: string; currency: string } | null; activity?: { id: string; name: string; reviewerMode: string } | null; invitation?: { title?: string | null; brief?: string | null; requiredPoints?: string[]; contentFormat?: string | null; contentCount?: number | null; language?: string | null; kol?: { username?: string | null; displayName?: string | null } | null; }; }

const apiBase = "/api/admin/business-collaboration";
const base = `${apiBase}/activities`;
export const fetchCollaborationActivities = () => apiRequest<{ success: boolean; data: CollaborationActivity[] }>(base);
export const fetchCollaborationActivityOverview = (id: string) => apiRequest<{ success: boolean; data: CollaborationActivityOverview }>(`${base}/${id}/overview`);
export const lookupCollaborationProjectAccount = (handle: string) => apiRequest<{ success: boolean; data: CollaborationProjectAccount }>(`${apiBase}/project-account?handle=${encodeURIComponent(handle)}`);
export const fetchCollaborationInternalTestUsers = () => apiRequest<{ success: boolean; data: CollaborationInternalTestUser[] }>(`${apiBase}/internal-test-users`);
export const createCollaborationActivity = (body: Partial<CollaborationActivity>) => apiRequest<{ success: boolean; data: CollaborationActivity }>(base, { method: "POST", body });
export const updateCollaborationActivity = (id: string, body: Partial<CollaborationActivity>) => apiRequest<{ success: boolean; data: CollaborationActivity }>(`${base}/${id}`, { method: "PATCH", body });
export const deleteCollaborationActivity = (id: string) => apiRequest<{ success: boolean }>(`${base}/${id}`, { method: "DELETE" });
export const grantCollaborationAccess = (id: string, body: { authCenterUserId: string; role: "project_manager" | "agency_manager"; reason?: string }) => apiRequest<{ success: boolean; data: CollaborationAccess }>(`${base}/${id}/accesses`, { method: "POST", body });
export const updateCollaborationAccess = (activityId: string, accessId: string, body: { status: "active" | "paused" | "revoked"; reason?: string }) => apiRequest<{ success: boolean; data: CollaborationAccess }>(`${base}/${activityId}/accesses/${accessId}`, { method: "PATCH", body });
export const fetchCollaborationReviewRounds = () => apiRequest<{ success: boolean; data: CollaborationReviewRound[] }>(`${apiBase}/review-rounds`);
export const decideCollaborationReviewRound = (id: string, body: { decision: "approved" | "changes_requested"; comment?: string; idempotencyKey?: string }) =>
  apiRequest<{ success: boolean; data: { round: CollaborationReviewRound; replay?: boolean } }>(`${apiBase}/review-rounds/${id}/human-decision`, {
    method: "POST",
    body: {
      ...body,
      idempotencyKey: body.idempotencyKey || `admin-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
