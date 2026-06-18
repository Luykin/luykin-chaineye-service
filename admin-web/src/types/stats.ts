export interface DauDetailItem {
  identityType?: "twitterId" | "fingerprint" | "legacy_pair" | "legacy_fingerprint";
  twitterId?: string | null;
  fingerprint?: string | null;
  userId: string;
  username?: string | null;
  displayName?: string | null;
}

export interface OverviewDailyActiveUserItem {
  date: string;
  displayDate: string;
  activeUsers: number;
}

export interface OverviewStatsResponse {
  success: boolean;
  data: {
    coreMetrics: {
      dailyActiveUsers: { value: number };
      dailyReviews: { value: number };
      dailyReviewUsers: { value: number };
      dailyNewUsers: { value: number };
    };
    totalMetrics: {
      totalUsers: number;
      totalAccounts: number;
      totalKOLUsers: number;
      kolBuckets?: {
        within200k?: number;
        within50k?: number;
        within20k?: number;
        within5k?: number;
      };
      totalPointsAwarded: number;
      averageRating: string;
    };
    periodMetrics: {
      weekly: {
        reviews: number;
        newUsers: number;
      };
      monthly: {
        reviews: number;
        newUsers: number;
      };
    };
    todayDetails: {
      newAccounts: number;
      pointsAwarded: number;
      kolReviews: number;
    };
    dailyActiveUsersData: OverviewDailyActiveUserItem[];
  };
}

export interface DailyCohortItem {
  cohortDate: string;
  newUsers: number;
  dailyActiveUsers: number;
  day2Active: number;
  day2Retention: string | number;
  day3Active: number;
  day3Retention: string | number;
  day4Active: number;
  day4Retention: string | number;
  day5Active: number;
  day5Retention: string | number;
  day6Active: number;
  day6Retention: string | number;
  day7Active: number;
  day7Retention: string | number;
  day8Active: number;
  day8Retention: string | number;
  day9Active: number;
  day9Retention: string | number;
  day10Active: number;
  day10Retention: string | number;
}

export interface DailyCohortsResponse {
  success: boolean;
  data: {
    cohorts: DailyCohortItem[];
    totalCohorts: number;
    dateRange: {
      startDate: string;
      endDate: string;
    };
  };
}

export interface NoteItem {
  id: string | number;
  note: string;
  createdAt: string;
  userUsername?: string | null;
  userDisplayName?: string | null;
  accountHandle?: string | null;
  accountDisplayName?: string | null;
}

export interface NotesResponse {
  success: boolean;
  data: {
    notes: NoteItem[];
    stats: {
      totalNotes: number;
      uniqueUsers: number;
      uniqueAccounts: number;
    };
    pagination: {
      currentPage: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
    };
    date: string;
  };
}

export interface LogSearchResultLine {
  lineNumber: number;
  content: string;
  isMatch: boolean;
}

export interface LogSearchResultItem {
  lineNumber: number;
  context: LogSearchResultLine[];
  matchLine: string;
  file: string;
  timestamp: number;
}

export interface LogSearchResponse {
  success: boolean;
  data: {
    query: string;
    scope?: string;
    contextMode?: string;
    contextLines?: number;
    availableScopes?: Array<{
      key: string;
      label: string;
    }>;
    totalMatches: number;
    results: LogSearchResultItem[];
    searchedFiles: number;
    totalFiles: number;
    fileSizes: Array<{
      name: string;
      size: number;
    }>;
  };
}



export interface LogRequestHandlersResponse {
  success: boolean;
  data: {
    internalTest: string[];
  };
}

export interface LogRequestResultItem {
  requestId: string;
  handler: string;
  method: string;
  url: string;
  time: string;
  timestamp: number;
  file: string;
  lineNumber: number;
}

export interface LogRequestsResponse {
  success: boolean;
  data: {
    handler: string;
    scope?: string;
    startTime: string;
    endTime: string;
    availableScopes?: Array<{
      key: string;
      label: string;
    }>;
    totalMatches: number;
    results: LogRequestResultItem[];
    searchedFiles: number;
    totalFiles: number;
    fileSizes: Array<{
      name: string;
      size: number;
    }>;
  };
}

export interface ErrorLogsResponse {
  success: boolean;
  data: {
    scope?: string;
    availableScopes?: Array<{
      key: string;
      label: string;
    }>;
    logs: string[];
    totalLines: number;
    files: Array<{
      name: string;
      size: number;
    }>;
  };
}

export interface RootdataQuotaResponse {
  success: boolean;
  data: {
    level: string;
    credits: number;
    totalCredits: number;
    used: number;
    usagePercent: number;
    lastMonthCredits?: number;
    periodStart: string;
    periodEnd: string;
  };
}

export interface RootdataProjectItem {
  id: number | string;
  projectName?: string | null;
  projectLink?: string | null;
  logo?: string | null;
  description?: string | null;
  twitterUrl?: string | null;
  socialLinks?: unknown;
  fundedAt?: string | null;
  detailFailuresNumber?: number | null;
  detailFetchedAt?: string | null;
  isInitial?: boolean;
  createdAt?: string | null;
}

export interface RootdataRelationshipProjectRef {
  id?: number | string;
  projectName?: string | null;
  projectLink?: string | null;
  logo?: string | null;
}

export interface RootdataRelationshipItem {
  id: number | string;
  round?: string | null;
  createdAt?: string | null;
  investorProject?: RootdataRelationshipProjectRef | null;
  fundedProject?: RootdataRelationshipProjectRef | null;
}

export interface RootdataDailyResponse {
  success: boolean;
  data: {
    date: string;
    projects: RootdataProjectItem[];
    relationships: RootdataRelationshipItem[];
    summary: {
      projectsCount: number;
      relationshipsCount: number;
    };
    pagination: {
      currentPage: number;
      pageSize: number;
      totalProjects: number;
      totalRelationships: number;
      totalProjectPages: number;
      totalRelationshipPages: number;
    };
  };
}

export interface RootdataSetInitialResponse {
  success: boolean;
  data: {
    date: string;
    updatedCount: number;
    message: string;
  };
}

export interface RootdataForceVerifyResponse {
  success: boolean;
  projectId?: string | number;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export interface RootdataManualCrawlResponse {
  success: boolean;
  error?: string;
  message?: string;
  data?: {
    duration?: number | string;
    project?: {
      projectName?: string | null;
      [key: string]: unknown;
    };
    asInvestor?: Array<Record<string, unknown>>;
    asInvestee?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export interface RootdataDetailPollutionProject {
  id: number | string;
  projectName?: string | null;
  projectLink?: string | null;
  entityType?: string;
  logo?: string | null;
  twitterUrl?: string | null;
  socialLinks?: Record<string, unknown> | null;
  detailFetchedAt?: number | string | null;
  detailFetchedAtIso?: string | null;
  updateProgram?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  severity: "critical" | "warning" | "review" | "ok";
  reasons: string[];
  reviewReasons: string[];
}

export interface RootdataDetailPollutionAuditResponse {
  success: boolean;
  data: {
    generatedAt: string;
    filter: {
      recentHours?: number | null;
      sinceMs?: number | null;
      sinceIso?: string | null;
      listLimit: number;
    };
    summary: {
      scanned: number;
      suspicious: number;
      critical: number;
      warning: number;
      review: number;
      definite: number;
      recrawlable?: number;
      unsupported?: number;
      byReason: Record<string, number>;
    };
    tampermonkeyQueue: Array<{
      id: number | string;
      entityType?: string;
      projectName?: string | null;
      projectLink?: string | null;
      reasons: string[];
    }>;
    projects: RootdataDetailPollutionProject[];
  };
}

export interface BackupFileItem {
  name: string;
  path?: string;
  size: number;
  sizeMB: string;
  mtime: string;
  mtimeStr: string;
}

export interface BackupRestoreGroup {
  key: string;
  label: string;
  description: string;
  tables: string[];
}

export interface BackupStatusResponse {
  success: boolean;
  data: {
    backups: BackupFileItem[];
    restoreGroups: BackupRestoreGroup[];
    stats: {
      totalBackups: number;
      maxBackups: number;
      totalSizeMB: string;
      backupDir: string;
    };
  };
}

export interface TriggerBackupResponse {
  success: boolean;
  message: string;
}

export interface RestoreBackupTablesResponse {
  success: boolean;
  message: string;
  data: {
    backupName: string;
    groupKey: string;
    groupLabel: string;
    tables: string[];
    beforeCounts: Record<string, number>;
    afterCounts: Record<string, number>;
    safetyBackup?: {
      name: string;
      sizeMB: string;
      createdAt: string;
    } | null;
    durationSeconds: number;
  };
}

export interface DeviceStatusResponse {
  timestamp: string;
  system?: {
    platform?: string;
    hostname?: string;
    uptime?: string;
    arch?: string;
  };
  cpu?: {
    cores?: number;
    model?: string;
    usage?: string;
    loadAverage?: string;
  };
  memory?: {
    total?: string;
    used?: string;
    free?: string;
    usagePercent?: string;
  };
  pm2?: Array<{
    name?: string;
    status?: string;
    cpu?: string;
    memory?: string;
    restarts?: number;
    uptime?: string;
  }>;
  redis?: {
    connected?: boolean;
    memory?: string;
    maxMemory?: string;
    memoryUsagePercent?: string;
    keys?: number;
    uptime?: string;
    version?: string;
    keyDistribution?: {
      sampled?: number;
      sampleLimit?: number;
      truncated?: boolean;
      scanIterations?: number;
      totalKeys?: number;
      error?: string;
      groups?: Array<{
        prefix: string;
        count: number;
        percent: number;
      }>;
    };
  };
  postgresql?: {
    connected?: boolean;
    version?: string;
    size?: string;
    connections?: number;
  };
  disk?: Array<{
    filesystem?: string;
    size?: string;
    used?: string;
    available?: string;
    usePercent?: string;
    mounted?: string;
  }>;
  sse?: {
    available?: boolean;
    [key: string]: unknown;
  };
}

export interface ClearCacheResponse {
  success?: boolean;
  error?: string;
  input?: string;
  deletedCount?: number;
  estimatedTotal?: number;
  samples?: string[];
  message?: string;
  timeout?: boolean;
  scanCount?: number;
  sync?: boolean;
  status?: string;
}

export interface SecurityViolationItem {
  id: number | string;
  createdAt: string;
  reasonCode?: string | null;
  errorDetail?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  queryString?: string | null;
  clientIp?: string | null;
  headers?: Record<string, unknown> | null;
  requestBody?: string | null;
  fingerprint?: string | null;
  extensionVersion?: string | null;
  requestTimestamp?: string | number | null;
  requestId?: string | null;
  windowLocationHref?: string | null;
  userAgent?: string | null;
}

export interface SecurityViolationsResponse {
  success: boolean;
  data: SecurityViolationItem[];
  topIps: Array<{
    ip: string;
    count: number;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DauDetailsResponse {
  success: boolean;
  data: {
    date: string;
    totalCount: number;
    details: DauDetailItem[];
  };
}

export interface OnlineUserItem {
  id: string;
  twitterId: string;
  username: string;
  displayName: string;
  lastUsed: string;
}

export interface OnlineUsersResponse {
  success: boolean;
  data: {
    users: OnlineUserItem[];
    pagination: {
      currentPage: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
    };
  };
}

export interface GenericStatsTypeItem {
  type: string;
  count: number;
  lastEventAt: string | null;
}

export interface GenericStatsTypesResponse {
  success: boolean;
  data: GenericStatsTypeItem[];
}

export interface GenericStatsAggregateItem {
  subjectId: string;
  subjectName: string;
  callCount: number;
  questionCount: number;
  uniqueUserCount: number;
}

export interface GenericStatsAggregateResponse {
  success: boolean;
  data: {
    type: string;
    summary: {
      totalKols: number;
      totalCallCount: number;
      totalQuestionCount: number;
      totalUniqueUserCount: number;
    };
    items: GenericStatsAggregateItem[];
  };
}

export interface GenericStatEventItem {
  id: number;
  type: string;
  source: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectName: string | null;
  actorType: string | null;
  actorId: string | null;
  actorName: string | null;
  eventAt: string;
  countValue: number;
  numericValue: string | number | null;
  dimensions?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface GenericStatsEventsResponse {
  success: boolean;
  data: {
    items: GenericStatEventItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface AuditLogItem {
  id: number;
  createdAt: string;
  email: string | null;
  action: string | null;
  method: string | null;
  route: string | null;
  success: boolean;
  message: string | null;
  ip: string | null;
}

export interface AuditLogsResponse {
  success: boolean;
  data: AuditLogItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}


export interface VersionStatsDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
  tension?: number;
}

export interface VersionStatsResponse {
  success: boolean;
  timeRange: string;
  labels: string[];
  datasets: VersionStatsDataset[];
  totalVersions: number;
  error?: string;
  message?: string;
}

export interface UrlStatsItem {
  urlPath: string;
  count: number;
  percent: string | number;
}

export interface UrlStatsResponse {
  success: boolean;
  timeRange: string;
  data: {
    urlStats: UrlStatsItem[];
    totalUrls: number;
    totalRequests: number;
    timeWindows: number;
  };
  error?: string;
  message?: string;
}
