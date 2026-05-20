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
