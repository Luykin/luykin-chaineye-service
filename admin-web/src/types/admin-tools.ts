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
