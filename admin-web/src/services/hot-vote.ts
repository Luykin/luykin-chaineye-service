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
  titleI18n?: { zh?: string; en?: string };
  titleHtml?: string | null;
  summary: string;
  summaryEn?: string;
  summaryI18n?: { zh?: string; en?: string };
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
