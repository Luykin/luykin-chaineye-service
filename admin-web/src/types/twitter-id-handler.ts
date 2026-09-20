export interface TwitterIdHandlerLookupData {
  twitterId: string;
  handler: string;
  displayName?: string | null;
  avatar?: string | null;
  source: "twitter-profile-api";
  twitterUrl: string;
}

export interface TwitterIdHandlerLookupResponse {
  success: boolean;
  data: TwitterIdHandlerLookupData;
}
