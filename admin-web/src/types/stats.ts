export interface DauDetailItem {
  fingerprint: string;
  userId: string;
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

export interface ErrorLogsResponse {
  success: boolean;
  data: {
    logs: string[];
    totalLines: number;
    files: Array<{
      name: string;
      size: number;
    }>;
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
