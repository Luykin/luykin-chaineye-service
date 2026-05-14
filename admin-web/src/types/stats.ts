export interface DauDetailItem {
  fingerprint: string;
  userId: string;
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
