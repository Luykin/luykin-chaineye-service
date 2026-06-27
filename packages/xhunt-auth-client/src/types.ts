export type XHuntAuthProviderName = "password" | "google" | "evm" | "twitter";
export type XHuntAuthThemeName = "xhunt" | "aqua" | "mono";
export type XHuntAuthThemeMode = "dark" | "light" | "auto";
export type XHuntAuthLocale = "en" | "zh-CN" | "zh-TW" | string;

export interface XHuntAuthTextOverrides {
  authCenterKicker?: string;
  title?: string;
  subtitle?: string;
  loginTab?: string;
  createTab?: string;
  accountLabel?: string;
  accountPlaceholder?: string;
  passwordLabel?: string;
  passwordPlaceholder?: string;
  continueButton?: string;
  createAccountButton?: string;
  divider?: string;
  googleButton?: string;
  twitterButton?: string;
  walletButton?: string;
  closeLabel?: string;
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
  genericError?: string;
  errors?: Record<string, string>;
}

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

export interface XHuntAuthConfig {
  apiBaseUrl: string;
  authBasePath?: string;
  clientKey: string;
  storage?: "localStorage";
  autoLoadUser?: boolean;
  oauthCallbackPath?: string;
  ui?: {
    /** Theme palette. Default is xhunt. Legacy values "light"/"dark" are treated as mode. */
    theme?: XHuntAuthThemeName | "light" | "dark";
    /** Color mode. Default is dark. */
    mode?: XHuntAuthThemeMode;
    /** Override CSS color tokens for brand customization. */
    tokens?: XHuntAuthThemeTokens;
    /** UI language. Built-ins: en, zh-CN, zh-TW. Default is en. */
    locale?: XHuntAuthLocale;
    /** Custom text overrides for built-in or custom languages. */
    texts?: XHuntAuthTextOverrides;
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
  transferCode?: string;
  returnUrl?: string;
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
  exchangeTransferCode(transferCode: string): Promise<XHuntLoginResult>;
  refresh(): Promise<XHuntTokenSet | null>;
  reloadUser(): Promise<XHuntAuthUser | null>;
  logout(options?: { allDevices?: boolean }): Promise<void>;
  openLoginModal(): void;
  closeLoginModal(): void;
  isLoginModalOpen: boolean;
}
