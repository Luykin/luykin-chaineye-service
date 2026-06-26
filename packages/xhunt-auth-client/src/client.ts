import { DEFAULT_STORAGE_KEY, XHuntAuthStorage } from "./storage";
import {
  OAuthCallbackInput,
  XHuntAuthConfig,
  XHuntAuthError,
  XHuntAuthErrorPayload,
  XHuntAuthProviderName,
  XHuntAuthUser,
  XHuntLoginResult,
  XHuntTokenSet,
  XHuntWalletChallenge,
} from "./types";

function trimSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string) {
  return `${trimSlashes(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseOAuthInput(input?: OAuthCallbackInput) {
  const url = input?.url || (typeof window !== "undefined" ? window.location.href : "");
  const parsed = url ? new URL(url) : null;
  return {
    code: input?.code || parsed?.searchParams.get("code") || "",
    state: input?.state || parsed?.searchParams.get("state") || "",
  };
}

async function parseErrorResponse(response: Response): Promise<XHuntAuthError> {
  let payload: XHuntAuthErrorPayload | undefined;
  try {
    payload = (await response.json()) as XHuntAuthErrorPayload;
  } catch (_) {
    payload = undefined;
  }
  const code = payload?.error || `HTTP_${response.status}`;
  return new XHuntAuthError(code, payload?.message || code, response.status, payload);
}

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    };
  }
}

export class XHuntAuthClient {
  readonly config: Required<Pick<XHuntAuthConfig, "authBasePath" | "storage" | "autoLoadUser">> &
    Omit<XHuntAuthConfig, "authBasePath" | "storage" | "autoLoadUser">;
  readonly storage: XHuntAuthStorage;

  constructor(config: XHuntAuthConfig) {
    if (!config.apiBaseUrl) {
      throw new XHuntAuthError("MISSING_API_BASE_URL");
    }
    if (!config.clientKey) {
      throw new XHuntAuthError("MISSING_CLIENT_KEY");
    }
    this.config = {
      ...config,
      authBasePath: config.authBasePath || "/api/xhunt/auth-center",
      storage: "localStorage",
      autoLoadUser: config.autoLoadUser ?? true,
    };
    this.storage = new XHuntAuthStorage(DEFAULT_STORAGE_KEY);
  }

  private endpoint(path: string) {
    return joinUrl(this.config.apiBaseUrl, `${this.config.authBasePath}${path}`);
  }

  private async request<T>(path: string, init: RequestInit = {}, withAuth = false): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (withAuth) {
      const token = this.getStoredToken()?.accessToken;
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(this.endpoint(path), {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  getStoredToken(): XHuntTokenSet | null {
    const value = this.storage.read();
    if (!value?.accessToken) return null;
    return value;
  }

  getStoredUser(): XHuntAuthUser | null {
    return this.storage.read()?.userSnapshot || null;
  }

  setToken(token: XHuntTokenSet, user?: XHuntAuthUser | null) {
    this.storage.write(token, user);
  }

  clearToken() {
    this.storage.clear();
  }

  async registerWithPassword(input: { accountName: string; password: string }): Promise<XHuntLoginResult> {
    const result = await this.request<XHuntLoginResult>("/password/register", {
      method: "POST",
      body: JSON.stringify({ ...input, clientKey: this.config.clientKey }),
    });
    this.setToken(result.token, result.user);
    return result;
  }

  async loginWithPassword(input: { accountName: string; password: string }): Promise<XHuntLoginResult> {
    const result = await this.request<XHuntLoginResult>("/password/login", {
      method: "POST",
      body: JSON.stringify({ ...input, clientKey: this.config.clientKey }),
    });
    this.setToken(result.token, result.user);
    return result;
  }

  async getGoogleUrl() {
    return this.request<{ url: string; clientKey: string }>("/google/url", {
      method: "POST",
      body: JSON.stringify({ clientKey: this.config.clientKey }),
    });
  }

  async getTwitterUrl() {
    return this.request<{ url: string; clientKey: string }>("/twitter/url", {
      method: "POST",
      body: JSON.stringify({ clientKey: this.config.clientKey }),
    });
  }

  async loginWithGoogle() {
    const { url } = await this.getGoogleUrl();
    window.location.href = url;
  }

  async loginWithTwitter() {
    const { url } = await this.getTwitterUrl();
    window.location.href = url;
  }

  async handleOAuthCallback(provider: "google" | "twitter", input?: OAuthCallbackInput): Promise<XHuntLoginResult> {
    const { code, state } = parseOAuthInput(input);
    if (!code || !state) {
      throw new XHuntAuthError("OAUTH_CALLBACK_MISSING_CODE_OR_STATE");
    }
    const result = await this.request<XHuntLoginResult>(`/${provider}/callback`, {
      method: "POST",
      body: JSON.stringify({ code, state }),
    });
    this.setToken(result.token, result.user);
    return result;
  }

  async getWalletNonce(address: string): Promise<XHuntWalletChallenge> {
    const params = new URLSearchParams({ address, clientKey: this.config.clientKey });
    return this.request<XHuntWalletChallenge>(`/wallet/nonce?${params.toString()}`);
  }

  async loginWithWalletAddress(address: string): Promise<XHuntLoginResult> {
    if (!window.ethereum) {
      throw new XHuntAuthError("WALLET_NOT_FOUND", "No EVM wallet provider found");
    }
    const challenge = await this.getWalletNonce(address);
    const signature = (await window.ethereum.request({
      method: "personal_sign",
      params: [challenge.message, challenge.address],
    })) as string;
    const result = await this.request<XHuntLoginResult>("/wallet/verify", {
      method: "POST",
      body: JSON.stringify({
        address: challenge.address,
        message: challenge.message,
        signature,
        clientKey: this.config.clientKey,
      }),
    });
    this.setToken(result.token, result.user);
    return result;
  }

  async loginWithWallet(): Promise<XHuntLoginResult> {
    if (!window.ethereum) {
      throw new XHuntAuthError("WALLET_NOT_FOUND", "No EVM wallet provider found");
    }
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts?.[0];
    if (!address) {
      throw new XHuntAuthError("WALLET_ACCOUNT_NOT_SELECTED");
    }
    return this.loginWithWalletAddress(address);
  }

  async getCurrentUser(): Promise<XHuntAuthUser | null> {
    const token = this.getStoredToken();
    if (!token?.accessToken) return null;
    const user = await this.request<XHuntAuthUser>("/me", { method: "GET" }, true);
    this.setToken(token, user);
    return user;
  }

  async refreshToken(): Promise<XHuntTokenSet | null> {
    const stored = this.getStoredToken();
    if (!stored?.refreshToken) return null;
    const result = await this.request<XHuntLoginResult>("/token/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
    this.setToken(result.token, result.user);
    return result.token;
  }

  async logout(options: { allDevices?: boolean } = {}) {
    const path = options.allDevices ? "/logout-all" : "/logout";
    try {
      await this.request<{ success: boolean }>(path, { method: "POST" }, true);
    } finally {
      this.clearToken();
    }
  }

  async bindPassword(input: { accountName: string; password: string }): Promise<XHuntAuthUser> {
    const result = await this.request<{ success: boolean; user: XHuntAuthUser }>(
      "/identities/password/bind",
      { method: "POST", body: JSON.stringify(input) },
      true
    );
    const token = this.getStoredToken();
    if (token) this.setToken(token, result.user);
    return result.user;
  }

  async bindWallet(): Promise<XHuntAuthUser> {
    if (!window.ethereum) throw new XHuntAuthError("WALLET_NOT_FOUND");
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts?.[0];
    if (!address) throw new XHuntAuthError("WALLET_ACCOUNT_NOT_SELECTED");
    const challenge = await this.getWalletNonce(address);
    const signature = (await window.ethereum.request({
      method: "personal_sign",
      params: [challenge.message, challenge.address],
    })) as string;
    const result = await this.request<{ success: boolean; user: XHuntAuthUser }>(
      "/identities/evm/bind",
      {
        method: "POST",
        body: JSON.stringify({ address: challenge.address, message: challenge.message, signature }),
      },
      true
    );
    const token = this.getStoredToken();
    if (token) this.setToken(token, result.user);
    return result.user;
  }

  async getIdentityBindUrl(provider: Extract<XHuntAuthProviderName, "google" | "twitter">) {
    return this.request<{ url: string; clientKey: string }>(
      `/identities/${provider}/url`,
      { method: "POST", body: JSON.stringify({ clientKey: this.config.clientKey }) },
      true
    );
  }

  async startIdentityBind(provider: Extract<XHuntAuthProviderName, "google" | "twitter">) {
    const { url } = await this.getIdentityBindUrl(provider);
    window.location.href = url;
  }

  async handleIdentityBindCallback(
    provider: Extract<XHuntAuthProviderName, "google" | "twitter">,
    input?: OAuthCallbackInput
  ): Promise<XHuntAuthUser> {
    const { code, state } = parseOAuthInput(input);
    if (!code || !state) throw new XHuntAuthError("OAUTH_CALLBACK_MISSING_CODE_OR_STATE");
    const result = await this.request<{ success: boolean; user: XHuntAuthUser }>(`/identities/${provider}/callback`, {
      method: "POST",
      body: JSON.stringify({ code, state }),
    });
    const token = this.getStoredToken();
    if (token) this.setToken(token, result.user);
    return result.user;
  }

  async unbindIdentity(identityId: string): Promise<XHuntAuthUser> {
    const result = await this.request<{ success: boolean; user: XHuntAuthUser }>(
      `/identities/${identityId}`,
      { method: "DELETE" },
      true
    );
    const token = this.getStoredToken();
    if (token) this.setToken(token, result.user);
    return result.user;
  }

  async getAccessToken(): Promise<string | null> {
    const token = this.getStoredToken();
    if (!token) return null;
    if (token.expiresAt && token.expiresAt - Date.now() < 30_000) {
      const refreshed = await this.refreshToken();
      return refreshed?.accessToken || null;
    }
    return token.accessToken;
  }

  async authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers || {});
    const token = await this.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response = await fetch(input, { ...init, headers });
    if (response.status === 401 || response.status === 419) {
      const refreshed = await this.refreshToken();
      if (refreshed?.accessToken) {
        headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
        response = await fetch(input, { ...init, headers });
      }
    }
    return response;
  }
}
