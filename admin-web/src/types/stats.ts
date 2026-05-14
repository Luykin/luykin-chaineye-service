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
