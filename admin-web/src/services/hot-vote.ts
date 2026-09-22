import { apiRequest } from "./apiClient";

export type HotVoteTopicStatus = "draft" | "published" | "ended" | "archived";
export type HotVoteTopicType = "person_pk" | "general_topic";

export interface HotVoteOption {
  id: string;
  name: string;
  nameEn?: string;
  nameI18n?: { zh?: string; en?: string };
  avatar?: string;
  twitterHandle?: string;
  color?: string;
  isGua?: boolean;
}

export interface HotVoteTopic {
  id: string;
  title: string;
  titleEn?: string;
  titleI18n?: { zh?: string; en?: string; zhHtml?: string; enHtml?: string };
  titleHtml?: string | null;
  summary: string;
  summaryEn?: string;
  summaryI18n?: { zh?: string; en?: string; zhHtml?: string; enHtml?: string };
  summaryHtml?: string | null;
  topicType: HotVoteTopicType;
  options: HotVoteOption[];
  displayDomains: string[];
  displayLanguages: string[];
  testingPhase: boolean;
  testList: string[];
  maxRevotes: number;
  status: HotVoteTopicStatus;
  sortWeight: number;
  startTime?: string | null;
  endTime?: string | null;
  createdAt: string;
  updatedAt: string;
  voteCount?: number;
  hasVotes?: boolean;
}

export interface HotVoteTopicListResult {
  list: HotVoteTopic[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface HotVoteInternalTester {
  id: string;
  username: string;
  twitterId: string;
}

const base = "/api/admin/hot-vote";

export const fetchHotVoteTopics = (params: { page: number; pageSize: number; status?: string; testingPhase?: string }) => {
  const search = new URLSearchParams();
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  if (params.status) search.set("status", params.status);
  if (params.testingPhase) search.set("testingPhase", params.testingPhase);
  return apiRequest<{ success: boolean; data: HotVoteTopicListResult }>(`${base}/topics?${search.toString()}`);
};

export const createHotVoteTopic = (body: Record<string, unknown>) =>
  apiRequest<{ success: boolean; data: HotVoteTopic }>(`${base}/topics`, { method: "POST", body });

export const updateHotVoteTopic = (id: string, body: Record<string, unknown>) =>
  apiRequest<{ success: boolean; data: HotVoteTopic }>(`${base}/topics/${id}`, { method: "PUT", body });

export const fetchHotVoteInternalTesters = () =>
  apiRequest<{ success: boolean; data: HotVoteInternalTester[] }>(`${base}/internal-testers`);

export interface HotVoteAdminComment {
  id: string;
  topicId: string;
  twitterId: string;
  xHuntUserId: string;
  userName: string;
  displayName?: string;
  userAvatar: string;
  content: string;
  isAnonymous: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HotVoteAdminVoteRecord {
  id: string;
  topicId: string;
  twitterId: string;
  optionId: string;
  optionName?: string;
  previousOptionId?: string;
  revoteCount: number;
  isAnonymous: boolean;
  clientIp?: string;
  commentContent?: string | null;
  commentDeleted?: boolean;
  commentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HotVoteAdminVotesSummary {
  totalParticipants: number;
  distribution: Array<{
    id: string;
    name: string;
    color: string;
    isGua: boolean;
    count: number;
    percentage: string;
  }>;
}

export interface HotVoteAdminVotesResult {
  summary: HotVoteAdminVotesSummary;
  list: HotVoteAdminVoteRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface HotVoteAdminCommentsResult {
  list: HotVoteAdminComment[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const fetchHotVoteAdminComments = (
  topicId: string,
  params: { page?: number; pageSize?: number; isDeleted?: string }
) => {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.isDeleted !== undefined) search.set("isDeleted", params.isDeleted);
  return apiRequest<{ success: boolean; data: HotVoteAdminCommentsResult }>(
    `${base}/topics/${topicId}/comments?${search.toString()}`
  );
};

export const deleteHotVoteAdminComment = (
  topicId: string,
  commentId: string,
  hard = false
) =>
  apiRequest<{ success: boolean; message: string }>(
    `${base}/topics/${topicId}/comments/${commentId}${hard ? "?hard=true" : ""}`,
    { method: "DELETE" }
  );

export const fetchHotVoteAdminVotes = (
  topicId: string,
  params: { page?: number; pageSize?: number; optionId?: string }
) => {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.optionId) search.set("optionId", params.optionId);
  return apiRequest<{ success: boolean; data: HotVoteAdminVotesResult }>(
    `${base}/topics/${topicId}/votes?${search.toString()}`
  );
};

export const deleteHotVoteAdminVote = (topicId: string, recordId: string) =>
  apiRequest<{ success: boolean; message: string }>(
    `${base}/topics/${topicId}/votes/${recordId}`,
    { method: "DELETE" }
  );
