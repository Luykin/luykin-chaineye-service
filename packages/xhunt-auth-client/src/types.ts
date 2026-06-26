export type XHuntAuthProviderName = "password" | "google" | "evm" | "twitter";
export type XHuntAuthThemeName = "xhunt" | "aqua" | "mono";
export type XHuntAuthThemeMode = "dark" | "light" | "auto";

export interface XHuntAuthThemeTokens {
  accent?: string;
  accent2?: string;
  background?: string;
  panel?: string;
  text?: string;
  muted?: string;
  border?: string;
  danger?: string;
}

export interface XHuntAuthWebSignatureConfig {
  /** Enable Web request signing. Default is true when publicSalt is provided. */
  enabled?: boolean;
  /** Web signature version. Default is w1. */
  version?: "w1";
  /** Public signing salt shared with the backend. */
  publicSalt?: string;
}

export interface XHuntAuthConfig {
  apiBaseUrl: string;
  authBasePath?: string;
  clientKey: string;
  storage?: "localStorage";
  autoLoadUser?: boolean;
  oauthCallbackPath?: string;
  webSignature?: XHuntAuthWebSignatureConfig;
  ui?: {
    /** Theme palette. Default is xhunt. Legacy values "light"/"dark" are treated as mode. */
    theme?: XHuntAuthThemeName | "light" | "dark";
    /** Color mode. Default is dark. */
    mode?: XHuntAuthThemeMode;
    /** Override CSS color tokens for brand customization. */
    tokens?: XHuntAuthThemeTokens;
    defaultProvider?: XHuntAuthProviderName;
    enabledProviders?: XHuntAuthProviderName[];
    title?: string;
    subtitle?: string;
  };
  onAuthStateChange?: (state: XHuntAuthState) => void;
  onError?: (error: XHuntAuthError) => void;
}

export interface XHuntAuthUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  providers: XHuntAuthProviderName[];
  xhuntUserId?: string | null;
  isLinkedToXHuntUser: boolean;
  twitter?: {
    twitterId: string;
    username?: string | null;
  } | null;
  google?: {
    email: string | null;
    emailVerified?: boolean;
  } | null;
  evm?: {
    address: string;
    shortAddress: string;
  } | null;
  accountName?: string | null;
  status?: string;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface XHuntTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: "Bearer";
  userSnapshot?: XHuntAuthUser | null;
}

export interface XHuntLoginResult {
  token: XHuntTokenSet;
  user: XHuntAuthUser;
  isNewUser?: boolean;
}

export interface XHuntAuthState {
  user: XHuntAuthUser | null;
  token: XHuntTokenSet | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: XHuntAuthError | null;
}

export interface XHuntAuthErrorPayload {
  error?: string;
  message?: string;
  requestId?: string;
  [key: string]: unknown;
}

export class XHuntAuthError extends Error {
  code: string;
  status?: number;
  payload?: XHuntAuthErrorPayload;

  constructor(code: string, message?: string, status?: number, payload?: XHuntAuthErrorPayload) {
    super(message || code);
    this.name = "XHuntAuthError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

export interface OAuthCallbackInput {
  code?: string;
  state?: string;
  url?: string;
}

export interface XHuntWalletChallenge {
  address: string;
  nonce: string;
  message: string;
  expiresIn: number;
}

export interface XHuntAuthStorageValue extends XHuntTokenSet {
  userSnapshot?: XHuntAuthUser | null;
}

export interface XHuntAuthContextValue extends XHuntAuthState {
  client: import("./client").XHuntAuthClient;
  loginWithPassword(input: { accountName: string; password: string }): Promise<XHuntLoginResult>;
  registerWithPassword(input: { accountName: string; password: string }): Promise<XHuntLoginResult>;
  loginWithGoogle(): Promise<void>;
  loginWithTwitter(): Promise<void>;
  loginWithWallet(): Promise<XHuntLoginResult>;
  handleOAuthCallback(provider?: "google" | "twitter", input?: OAuthCallbackInput): Promise<XHuntLoginResult>;
  refresh(): Promise<XHuntTokenSet | null>;
  reloadUser(): Promise<XHuntAuthUser | null>;
  logout(options?: { allDevices?: boolean }): Promise<void>;
  openLoginModal(): void;
  closeLoginModal(): void;
  isLoginModalOpen: boolean;
}
