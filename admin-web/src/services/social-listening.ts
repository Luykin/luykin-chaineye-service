import { apiRequest, buildApiUrl } from "./apiClient";

const BASE_PATH = "/api/admin/social-listening";

export interface SocialListeningBoard {
  id: string;
  officialTwitterId?: string | null;
  officialHandle: string;
  projectName: string;
  projectDescription?: string | null;
  projectAvatar?: string | null;
  verified?: boolean | null;
  followersCount?: number | null;
  globalRank?: number | null;
  cnRank?: number | null;
  brandColor?: string | null;
  status: string;
  coverageStartAt?: string | null;
  processedThrough?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastFailureReason?: string | null;
  createdByAdminId?: number | null;
  updatedByAdminId?: number | null;
  metadata?: Record<string, unknown>;
  latestJob?: SocialListeningJob | null;
  accessCount?: number;
  postCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SocialListeningAccess {
  id: string;
  boardId: string;
  twitterId?: string | null;
  twitterHandle: string;
  authCenterUserId?: string | null;
  xhuntUserId?: string | null;
  status: string;
  grantedAt?: string | null;
  revokedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SocialListeningJob {
  id: string;
  boardId: string;
  jobType: string;
  status: string;
  rangeStartAt?: string | null;
  rangeEndAt?: string | null;
  progress?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SocialListeningAlert {
  id: string;
  boardId: string;
  alertType: string;
  severity: string;
  titleZh: string;
  messageZh: string;
  triggeredAt: string;
  lastSeenAt: string;
  status: string;
  sampleSize?: number | null;
  currentValue?: Record<string, unknown>;
  baselineValue?: Record<string, unknown> | null;
  evidenceTweetIds?: string[] | null;
}

export interface SocialListeningAccountSignal {
  id: string;
  boardId: string;
  twitterId: string;
  handle?: string | null;
  name?: string | null;
  avatar?: string | null;
  followersCount?: number | null;
  globalRank?: number | null;
  cnRank?: number | null;
  signalType: string;
  occurredAt: string;
  mentionCount?: number | null;
  viewsCount?: number | null;
  engagementCount?: number | null;
  sentiment?: string | null;
  topics?: string[] | null;
  postIds?: string[] | null;
  summaryZh?: string | null;
  rankSnapshot?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SocialListeningPost {
  id: string;
  tweetId: string;
  tweetUrl: string;
  author: {
    twitterId: string;
    handle?: string | null;
    name?: string | null;
    avatar?: string | null;
    followersCount?: number | null;
    globalRank?: number | null;
    cnRank?: number | null;
  };
  postCreatedAt: string;
  text?: string | null;
  postZh?: string | null;
  source: string;
  sentiment: string;
  metrics: { views: number; likes: number; reposts: number; quotes: number; replies: number; engagement: number };
  topics?: string[];
  keywords?: string[];
  summaryZh?: string | null;
  summaryEn?: string | null;
  sentimentSummaryZh?: string | null;
  projectAttitudeScore?: number | null;
}

export interface SocialListeningPageData<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  rangeKey?: string;
}

export interface SocialListeningAiRuntimeConfig {
  apiKey?: string;
  apiKeyConfigured?: boolean;
  apiKeyMasked?: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tweetTagModel?: string;
  projectAttitudeModel?: string;
  tweetSummaryModel?: string;
  systemPrompt?: string;
  timeoutMs: number;
  maxRetries: number;
  summaryWords: number;
  promptMaxLength: number;
  contentEnabled: boolean;
  projectAttitudeEnabled: boolean;
  contentBatchSize: number;
  projectAttitudeBatchSize: number;
  contentConcurrency?: number;
  projectAttitudeConcurrency?: number;
  maxTextLength?: number;
  negativeScoreThreshold: number;
  positiveScoreThreshold: number;
  tweetTagMaxTokens?: number;
  projectAttitudeMaxTokens?: number;
  tweetSummaryMaxTokens?: number;
  estimateInputPricePerMillion: number;
  estimateOutputPricePerMillion: number;
  estimateContentInputTokens: number;
  estimateContentOutputTokens: number;
  estimateProjectAttitudeInputTokens: number;
  estimateProjectAttitudeOutputTokens: number;
  prompts?: Record<string, string>;
}

export interface SocialListeningAiWorkerConfig {
  mode: "enabled" | "disabled";
  tickIntervalMs: number;
  maxBoardsPerTick: number;
  contentBatchSize: number;
  projectAttitudeBatchSize: number;
  contentConcurrency: number;
  projectAttitudeConcurrency: number;
  maxTextLength: number;
}

export interface SocialListeningRuntimeConfig {
  version: string;
  scan?: Record<string, unknown>;
  ai: SocialListeningAiRuntimeConfig;
  aiWorker?: SocialListeningAiWorkerConfig;
  scheduler?: Record<string, unknown>;
  alert?: Record<string, unknown>;
  refresh?: Record<string, unknown>;
  export?: Record<string, unknown>;
}

export interface SocialListeningAiPendingStats {
  boardCount: number;
  totalPosts: number;
  contentPendingPosts: number;
  projectAttitudePendingPosts: number;
  contentAnalyzedPosts: number;
  projectAttitudeAnalyzedPosts: number;
}

export interface SocialListeningAiCostEstimate {
  posts: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  estimatedUsd: number;
  assumption: string;
}

export interface SocialListeningAiProgressItem {
  done: number;
  pending: number;
  total: number;
  percent: number;
  batchSize: number;
  batchesRemaining: number;
  estimatedMinutesRemaining: number;
}

export interface SocialListeningAiProgress {
  content: SocialListeningAiProgressItem;
  projectAttitude: SocialListeningAiProgressItem;
  intervalMinutes: number;
  estimatedMinutesRemaining: number;
  assumption: string;
}

export interface SocialListeningAiFieldDoc {
  field: string;
  label: string;
  desc: string;
}

export interface SocialListeningAiWorkerStatus {
  state: "running" | "paused";
  redisState: string;
  configMode: string;
  paused: boolean;
  enabled: boolean;
  config: SocialListeningAiWorkerConfig;
  lastRun?: Record<string, unknown> | null;
}

export interface SocialListeningRuntimeConfigResponse {
  dataId: string;
  group: string;
  config: SocialListeningRuntimeConfig;
  source: string;
  loadError?: string | null;
  stats: SocialListeningAiPendingStats;
  costEstimate: SocialListeningAiCostEstimate;
  fieldDocs: SocialListeningAiFieldDoc[];
  aiWorkerStatus?: SocialListeningAiWorkerStatus;
}

export interface SocialListeningBoardAiRuntimeConfig {
  contentEnabled: boolean;
  projectAttitudeEnabled: boolean;
  model: string;
  tweetTagModel?: string;
  tweetSummaryModel?: string;
  projectAttitudeModel?: string;
  estimatePosts: number;
  costAcceptedAt?: string | null;
  costAcceptedByAdminId?: number | null;
  acceptedEstimatedUsd?: number;
  acceptedCalls?: number;
  updatedAt?: string | null;
  effective: {
    contentEnabled: boolean;
    projectAttitudeEnabled: boolean;
    model: string;
    tweetTagModel: string;
    tweetSummaryModel: string;
    projectAttitudeModel: string;
    baseURL: string;
    apiKeyConfigured: boolean;
    globalContentEnabled: boolean;
    globalProjectAttitudeEnabled: boolean;
    ready: boolean;
  };
}

export interface SocialListeningBoardAiConfigResponse {
  board: { id: string; officialHandle: string; projectName: string };
  config: SocialListeningBoardAiRuntimeConfig;
  runtime: SocialListeningAiRuntimeConfig;
  stats: SocialListeningAiPendingStats;
  progress?: SocialListeningAiProgress;
  costEstimate: SocialListeningAiCostEstimate;
  blockingReasons: string[];
  rules: string[];
  fieldDocs: SocialListeningAiFieldDoc[];
}

export interface ResolvedTwitterAccount {
  twitterId: string | null;
  handle: string | null;
  handleLower: string | null;
  name: string | null;
  description?: string | null;
  avatar?: string | null;
  verified?: boolean | null;
  followersCount?: number | null;
  globalRank?: number | null;
  cnRank?: number | null;
}

function withQuery(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function fetchSocialListeningBoards(query?: { page?: number; pageSize?: number; q?: string; status?: string }) {
  return apiRequest<{ success: boolean; data: SocialListeningPageData<SocialListeningBoard> }>(withQuery(`${BASE_PATH}/monitored-accounts`, query));
}

export function fetchSocialListeningRuntimeConfig(query?: { estimatePosts?: number }) {
  return apiRequest<{ success: boolean; data: SocialListeningRuntimeConfigResponse }>(withQuery(`${BASE_PATH}/runtime-config`, query));
}

export function updateSocialListeningRuntimeConfig(payload: { ai: Partial<SocialListeningAiRuntimeConfig>; aiWorker?: Partial<SocialListeningAiWorkerConfig>; apiKeyAction?: "keep" | "replace" | "clear" }) {
  return apiRequest<{ success: boolean; data: SocialListeningRuntimeConfigResponse }>(`${BASE_PATH}/runtime-config`, {
    method: "POST",
    body: payload,
  });
}

export function fetchSocialListeningAiWorkerStatus() {
  return apiRequest<{ success: boolean; data: SocialListeningAiWorkerStatus }>(`${BASE_PATH}/ai-worker/status`);
}

export function pauseSocialListeningAiWorker() {
  return apiRequest<{ success: boolean; data: SocialListeningAiWorkerStatus }>(`${BASE_PATH}/ai-worker/pause`, { method: "POST" });
}

export function resumeSocialListeningAiWorker() {
  return apiRequest<{ success: boolean; data: SocialListeningAiWorkerStatus }>(`${BASE_PATH}/ai-worker/resume`, { method: "POST" });
}

export function fetchSocialListeningBoardAiConfig(boardId: string, query?: { estimatePosts?: number }) {
  return apiRequest<{ success: boolean; data: SocialListeningBoardAiConfigResponse }>(withQuery(`${BASE_PATH}/boards/${boardId}/ai-config`, query));
}

export function updateSocialListeningBoardAiConfig(boardId: string, payload: { ai: Partial<SocialListeningBoardAiRuntimeConfig> & { acceptCost?: boolean }; acceptCost?: boolean }) {
  return apiRequest<{ success: boolean; data: SocialListeningBoardAiConfigResponse }>(`${BASE_PATH}/boards/${boardId}/ai-config`, {
    method: "POST",
    body: payload,
  });
}

export function resolveSocialListeningAccount(handle: string) {
  return apiRequest<{ success: boolean; data: ResolvedTwitterAccount }>(`${BASE_PATH}/monitored-accounts/resolve`, {
    method: "POST",
    body: { handle },
  });
}

export function createSocialListeningBoard(payload: Record<string, unknown>) {
  return apiRequest<{ success: boolean; data: { board: SocialListeningBoard; created: boolean; job?: SocialListeningJob | null } }>(`${BASE_PATH}/monitored-accounts`, {
    method: "POST",
    body: payload,
  });
}

export function updateSocialListeningBoard(boardId: string, payload: Record<string, unknown>) {
  return apiRequest<{ success: boolean; data: SocialListeningBoard }>(`${BASE_PATH}/monitored-accounts/${boardId}`, {
    method: "PATCH",
    body: payload,
  });
}

export function pauseSocialListeningBoard(boardId: string) {
  return apiRequest<{ success: boolean; data: SocialListeningBoard }>(`${BASE_PATH}/boards/${boardId}/pause`, { method: "POST" });
}

export function resumeSocialListeningBoard(boardId: string) {
  return apiRequest<{ success: boolean; data: { board: SocialListeningBoard; job: SocialListeningJob; reused: boolean } }>(`${BASE_PATH}/boards/${boardId}/resume`, { method: "POST" });
}

export function deleteSocialListeningBoard(boardId: string) {
  return apiRequest<{ success: boolean }>(`${BASE_PATH}/boards/${boardId}`, { method: "DELETE" });
}

export function refreshSocialListeningBoard(boardId: string) {
  return apiRequest<{ success: boolean; data: { job: SocialListeningJob; reused: boolean } }>(`${BASE_PATH}/boards/${boardId}/refresh`, { method: "POST" });
}

export function fetchSocialListeningAccesses(boardId: string, query?: { page?: number; pageSize?: number; status?: string }) {
  return apiRequest<{ success: boolean; data: SocialListeningPageData<SocialListeningAccess> }>(withQuery(`${BASE_PATH}/boards/${boardId}/accesses`, query));
}

export function grantSocialListeningAccess(boardId: string, payload: { twitterHandle: string; twitterId?: string | null }) {
  return apiRequest<{ success: boolean; data: { access: SocialListeningAccess; created: boolean } }>(`${BASE_PATH}/boards/${boardId}/accesses`, {
    method: "POST",
    body: payload,
  });
}

export function revokeSocialListeningAccess(boardId: string, accessId: string) {
  return apiRequest<{ success: boolean; data: SocialListeningAccess }>(`${BASE_PATH}/boards/${boardId}/accesses/${accessId}`, { method: "DELETE" });
}

export function fetchSocialListeningJobs(query?: { page?: number; pageSize?: number; boardId?: string; status?: string; jobType?: string }) {
  return apiRequest<{ success: boolean; data: SocialListeningPageData<SocialListeningJob> }>(withQuery(`${BASE_PATH}/jobs`, query));
}

export function retrySocialListeningJob(jobId: string) {
  return apiRequest<{ success: boolean; data: SocialListeningJob }>(`${BASE_PATH}/jobs/${jobId}/retry`, { method: "POST" });
}

export function fetchSocialListeningAlerts(query?: { page?: number; pageSize?: number; boardId?: string; status?: string; type?: string; severity?: string }) {
  return apiRequest<{ success: boolean; data: SocialListeningPageData<SocialListeningAlert> }>(withQuery(`${BASE_PATH}/alerts`, query));
}

export function fetchSocialListeningSignals(boardId: string, query?: { page?: number; pageSize?: number; range?: string; type?: string }) {
  return apiRequest<{ success: boolean; data: SocialListeningPageData<SocialListeningAccountSignal> }>(withQuery(`${BASE_PATH}/boards/${boardId}/accounts`, query));
}

export function fetchSocialListeningPosts(boardId: string, query?: { page?: number; pageSize?: number; range?: string; sentiment?: string; source?: string; q?: string; sort?: string }) {
  return apiRequest<{ success: boolean; data: SocialListeningPageData<SocialListeningPost> }>(withQuery(`${BASE_PATH}/boards/${boardId}/posts`, query));
}

export function buildSocialListeningExportUrl(boardId: string, query?: { range?: string; sentiment?: string; source?: string; q?: string; sort?: string }) {
  return buildApiUrl(withQuery(`${BASE_PATH}/boards/${boardId}/posts/export`, query));
}
