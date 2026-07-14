export interface ServerCommandResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  cwd?: string;
  executionTime?: number;
  error?: string;
  message?: string;
}

export interface SendMessagesResponse {
  success: boolean;
  message?: string;
  data: {
    success: Array<{
      username: string;
      userId: string;
      messageId: string;
    }>;
    notFound: string[];
    alreadySent: string[];
    errors: Array<{
      username: string;
      error: string;
    }>;
  };
}

export interface CreatorAuthQueryResponse {
  success: boolean;
  data: {
    requestedUsername: string;
    username: string;
    found: boolean;
    twitterId?: string | null;
    authCreator: {
      recordTime: string | null;
      status: number | null;
      statusLabel: string;
      twitterId: string | null;
    } | null;
  };
  error?: string;
}

export interface UserPrivateMessageItem {
  id: string;
  title: string;
  content: string;
  displayAt?: string | null;
  sentAt?: string | null;
  isRead: boolean;
  campaignId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface UserPrivateMessagesResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      username?: string | null;
      twitterId?: string | null;
      displayName?: string | null;
      avatar?: string | null;
    } | null;
    messages: UserPrivateMessageItem[];
    pagination: {
      currentPage: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
    };
  };
  error?: string;
}
