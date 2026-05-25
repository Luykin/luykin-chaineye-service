export interface BinanceSquareApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface BinanceSquareStats {
  seedCount: number;
  targetCount: number;
  postCount: number;
  snapshotCount: number;
  snapshotStorageBytes: number;
  lastCrawlAt: string | null;
  lastCrawlStatus: string | null;
}

export interface BinanceSquareSeedItem {
  username: string;
  displayName?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  description?: string | null;
  totalFollowingCount?: number | null;
  apiTotalFollowingCount?: number | null;
  lastCrawledAt?: string | null;
  lastFollowingSyncedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BinanceSquareFollowingUser {
  followingUsername: string;
  followingSquareUid?: string | null;
  isActive?: boolean | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  createdAt?: string;
  displayName?: string | null;
  avatar?: string | null;
  totalFollowerCount?: number | null;
  totalPostCount?: number | null;
}

export interface BinanceSquarePaginated<T> {
  total: number;
  page: number;
  pageSize: number;
  data: T[];
}

export interface BinanceSquareTargetRankItem {
  id?: number;
  username: string;
  squareUid?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  biography?: string | null;
  role?: number | null;
  verificationType?: number | null;
  verificationDescription?: string | null;
  totalFollowerCount?: number | null;
  totalFollowingCount?: number | null;
  totalPostCount?: number | null;
  totalLikeCount?: number | null;
  totalShareCount?: number | null;
  accountLang?: string | null;
  isKol?: boolean | null;
  userStatus?: number | null;
  level?: number | null;
  lastCrawledAt?: string | null;
  lastFollowingSyncedAt?: string | null;
  aiOneLineIntro?: string | null;
  aiOneLineIntroI18n?: { zh?: string | null; en?: string | null } | null;
  aiOneLineIntroZh?: string | null;
  aiOneLineIntroEn?: string | null;
  aiIntroStatus?: string | null;
  aiIntroModel?: string | null;
  aiIntroPromptVersion?: string | null;
  aiIntroGeneratedAt?: string | null;
  aiIntroError?: string | null;
  rankSet?: string;
  rank: number;
  followerCount: number;
  sourceRankSet?: string | null;
  sourceUserCount?: number | null;
  seedFollowers?: Array<{
    username: string;
    displayName?: string | null;
  }>;
  sourceFollowers?: Array<{
    username: string;
    displayName?: string | null;
    rank?: number | null;
  }>;
  includedRankSets?: string[] | null;
  calculationRunId?: string | null;
  lastCalculatedAt?: string;
}

export interface BinanceSquarePostItem {
  id: number;
  postId?: string | null;
  username: string;
  title?: string | null;
  content?: string | null;
  contentText?: string | null;
  postType?: string | null;
  likeCount?: number | null;
  shareCount?: number | null;
  commentCount?: number | null;
  viewCount?: number | null;
  score?: number | null;
  viewScore?: number | null;
  shareScore?: number | null;
  commentScore?: number | null;
  likeScore?: number | null;
  freshnessScore?: number | null;
  scoreVersion?: string | null;
  lastScoredAt?: string | null;
  publishedAt?: string | null;
  postUrl?: string | null;
  sourceUrl?: string | null;
  isDeleted?: boolean | null;
  createdAt?: string;
}

export interface BinanceSquareCrawlLogItem {
  id: number | string;
  taskType: string;
  status: string;
  targetId?: string | null;
  itemsCount?: number | null;
  durationMs?: number | null;
  snapshotId?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
}

export interface BinanceSquareCrawlStatus {
  control: string;
  isRunning: boolean;
  isCrawling: boolean;
  currentTask?: {
    taskType?: string;
    snapshotId?: string;
    processedUsers?: number;
    totalUsers?: number;
    successUsers?: number;
    failedUsers?: number;
    errorRate?: number;
    totalPostsAll?: number;
    totalPostsReply?: number;
    totalUpsertedPosts?: number;
    daysBack?: number | null;
    filterTypes?: string[] | null;
    startedAt?: string;
  } | null;
  lastCrawl?: {
    taskType?: string;
    status?: string;
    itemsCount?: number;
    snapshotId?: string;
    durationMs?: number;
    createdAt?: string;
  } | null;
  postCrawlCooldownMinutes?: number;
  postCrawlDaysBack?: number;
  postCrawlConcurrency?: number;
  postCrawlFilterTypes?: string;
  incrementalCrawlInterval?: number;
}

export interface BinanceSquareProgress {
  running: boolean;
  message?: string;
  taskType?: string;
  snapshotId?: string;
  totalUsers?: number;
  processedUsers?: number;
  successUsers?: number;
  failedUsers?: number;
  errorRate?: number;
  errors?: Array<{ username?: string; error?: string }>;
  totalPostsAll?: number;
  totalPostsReply?: number;
  totalUpsertedPosts?: number;
  totalSnapshots?: number;
  scoredPosts?: number;
  daysBack?: number | null;
  filterTypes?: string[] | null;
  startedAt?: string;
  completedAt?: string | null;
  durationMs?: number | null;
  status?: string;
}

export interface BinanceSquareTargetProgressDetail {
  running?: boolean;
  taskType?: string;
  runId?: string;
  rankSet?: string;
  sourceRankSet?: string;
  status?: string;
  stage?: string;
  totalSourceUsers?: number;
  processedSourceUsers?: number;
  failedSourceUsers?: number;
  partialSourceUsers?: number;
  totalNewUsers?: number;
  totalRelations?: number;
  totalDeactivated?: number;
  candidateCount?: number;
  rankedCount?: number;
  currentSourceUser?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  durationMs?: number;
}

export interface BinanceSquareUserIntroProgressDetail {
  running?: boolean;
  taskType?: string;
  taskId?: string;
  rankSet?: string;
  status?: string;
  total?: number;
  processed?: number;
  success?: number;
  failed?: number;
  skipped?: number;
  currentUsername?: string | null;
  currentLine?: number;
  concurrency?: number;
  postLimit?: number;
  model?: string | null;
  promptVersion?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  durationMs?: number;
  lastResult?: Record<string, unknown>;
}

export interface BinanceSquareUserIntroProgress {
  running: boolean;
  message?: string;
  latest?: BinanceSquareUserIntroProgressDetail;
  list?: BinanceSquareUserIntroProgressDetail[];
}

export interface BinanceSquareTargetProgress {
  running: boolean;
  message?: string;
  latest?: BinanceSquareTargetProgressDetail;
  list?: BinanceSquareTargetProgressDetail[];
}

export interface BinanceSquareConfigItem {
  configKey: string;
  configValue: string;
  description?: string | null;
  unit?: string | null;
  minValue?: number | string | null;
  maxValue?: number | string | null;
  updatedBy?: string | null;
  updatedAt?: string;
}

export interface BinanceSquareActionResult {
  message?: string;
  status?: string;
  totalSeeds?: number;
  processed?: number;
  newUsers?: number;
  newRelations?: number;
  details?: Array<Record<string, unknown>>;
  totalCandidates?: number;
  top50?: Array<Record<string, unknown>>;
  updatedAt?: string;
  durationMs?: number;
  mode?: string;
  control?: string;
  note?: string;
  [key: string]: unknown;
}
