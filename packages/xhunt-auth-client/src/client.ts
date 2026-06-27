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

function getUrlParamFromSearchOrHash(name: string) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const fromSearch = url.searchParams.get(name);
  if (fromSearch) return fromSearch;
  const hash = url.hash || "";
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return "";
  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  return hashParams.get(name) || "";
}

function removeUrlParams(names: string[]) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  names.forEach((name) => url.searchParams.delete(name));
  if (url.hash) {
    const queryIndex = url.hash.indexOf("?");
    if (queryIndex >= 0) {
      const hashPath = url.hash.slice(0, queryIndex);
      const hashParams = new URLSearchParams(url.hash.slice(queryIndex + 1));
      names.forEach((name) => hashParams.delete(name));
      const nextHashQuery = hashParams.toString();
      url.hash = nextHashQuery ? `${hashPath}?${nextHashQuery}` : hashPath;
    }
  }
  window.history.replaceState({}, document.title, url.toString());
}

const WEB_SIGN_VERSION = "w1";
const AUTH_CLIENT_SDK_VERSION = "0.1.0";
const WEB_PUBLIC_SIGN_SALT = "xhunt-web-sign-w1-fixed-lite-20260626";

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getCrypto() {
  const cryptoLike = globalThis.crypto;
  if (!cryptoLike?.subtle) {
    throw new XHuntAuthError("WEB_SIGNATURE_CRYPTO_UNAVAILABLE", "Web Crypto is not available");
  }
  return cryptoLike;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(await getCrypto().subtle.digest("SHA-256", bytes));
}

async function hmacSha256Hex(key: string, payload: string) {
  const cryptoLike = getCrypto();
  const cryptoKey = await cryptoLike.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await cryptoLike.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return bytesToHex(signature);
}

function randomRequestId() {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const next = char === "x" ? value : (value & 0x3) | 0x8;
    return next.toString(16);
  });
}

function getBodyText(body: BodyInit | null | undefined) {
  if (!body) return "";
  if (typeof body === "string") return body;
  return String(body);
}

function normalizePathWithQuery(url: string) {
  const parsed = new URL(url);
  const entries: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    if (key.toLowerCase().startsWith("x-xhunt-web-")) return;
    entries.push([key, value]);
  });
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  if (!entries.length) return parsed.pathname;
  const search = new URLSearchParams();
  entries.forEach(([key, value]) => search.append(key, value));
  return `${parsed.pathname}?${search.toString()}`;
}

function getOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin || "";
}

function getPageUrl() {
  if (typeof window === "undefined") return "";
  return window.location.href || "";
}

function resolveFetchUrl(input: RequestInfo | URL) {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") {
    if (typeof window === "undefined") return input;
    return new URL(input, window.location.origin).toString();
  }
  return input.url;
}

async function derivePublicSigningKey(clientKey: string, publicSalt: string) {
  return sha256Hex(`${clientKey}:${publicSalt}:xhunt-web-w1`);
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

  private async applyWebSignature(endpoint: string, init: RequestInit, headers: Headers) {
    const publicSalt = WEB_PUBLIC_SIGN_SALT;

    const requestId = randomRequestId();
    const timestamp = String(Date.now());
    const bodyText = getBodyText(init.body as BodyInit | null | undefined);
    const bodyHash = await sha256Hex(bodyText);
    const authHeader = headers.get("Authorization") || "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const accessTokenHash = tokenMatch ? await sha256Hex(tokenMatch[1]) : "";
    const canonicalPayload = [
      (init.method || "GET").toUpperCase(),
      normalizePathWithQuery(endpoint),
      timestamp,
      requestId,
      this.config.clientKey,
      getOrigin(),
      bodyHash,
      accessTokenHash,
    ].join("\n");
    const signingKey = await derivePublicSigningKey(this.config.clientKey, publicSalt);
    const signature = await hmacSha256Hex(signingKey, canonicalPayload);

    headers.set("x-xhunt-web-sign-version", WEB_SIGN_VERSION);
    headers.set("x-xhunt-web-client-key", this.config.clientKey);
    headers.set("x-xhunt-web-request-id", requestId);
    headers.set("x-xhunt-web-timestamp", timestamp);
    headers.set("x-xhunt-web-body-sha256", bodyHash);
    headers.set("x-xhunt-web-signature", signature);
    headers.set("x-xhunt-web-sdk-version", AUTH_CLIENT_SDK_VERSION);
    headers.set("x-xhunt-web-page-url", getPageUrl());
    headers.set("x-xhunt-web-origin", getOrigin());
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

    const endpoint = this.endpoint(path);
    await this.applyWebSignature(endpoint, init, headers);

    const response = await fetch(endpoint, {
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
      body: JSON.stringify({ clientKey: this.config.clientKey, returnUrl: getPageUrl() }),
    });
  }

  async getTwitterUrl() {
    return this.request<{ url: string; clientKey: string }>("/twitter/url", {
      method: "POST",
      body: JSON.stringify({ clientKey: this.config.clientKey, returnUrl: getPageUrl() }),
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

  async handleOAuthCallbackAuto(input?: OAuthCallbackInput): Promise<XHuntLoginResult> {
    const url = input?.url || (typeof window !== "undefined" ? window.location.href : "");
    const provider = url ? new URL(url).searchParams.get("provider") || new URL(url).searchParams.get("auth_provider") : "";
    if (provider === "google" || provider === "twitter") {
      return this.handleOAuthCallback(provider, input);
    }
    try {
      return await this.handleOAuthCallback("google", input);
    } catch (error) {
      if (error instanceof XHuntAuthError && error.code !== "INVALID_OR_EXPIRED_STATE") {
        throw error;
      }
      return this.handleOAuthCallback("twitter", input);
    }
  }

  async exchangeTransferCode(transferCode: string): Promise<XHuntLoginResult> {
    const result = await this.request<XHuntLoginResult>("/token/exchange", {
      method: "POST",
      body: JSON.stringify({ transferCode }),
    });
    this.setToken(result.token, result.user);
    this.clearReturnParamsFromUrl();
    return result;
  }

  getTransferCodeFromUrl() {
    return getUrlParamFromSearchOrHash("authTransferCode") || getUrlParamFromSearchOrHash("transferCode");
  }

  getReturnErrorFromUrl() {
    const code = getUrlParamFromSearchOrHash("authError");
    if (!code) return null;
    return {
      code,
      message: getUrlParamFromSearchOrHash("authErrorMessage") || code,
    };
  }

  getBindSuccessFromUrl() {
    return getUrlParamFromSearchOrHash("authBindSuccess") || "";
  }

  clearReturnParamsFromUrl() {
    removeUrlParams(["authTransferCode", "transferCode", "authError", "authErrorMessage", "authBindSuccess", "authBindProvider"]);
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
      { method: "POST", body: JSON.stringify({ clientKey: this.config.clientKey, returnUrl: getPageUrl() }) },
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
    await this.applyWebSignature(resolveFetchUrl(input), init, headers);
    let response = await fetch(input, { ...init, headers });
    if (response.status === 401 || response.status === 419) {
      const refreshed = await this.refreshToken();
      if (refreshed?.accessToken) {
        headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
        await this.applyWebSignature(resolveFetchUrl(input), init, headers);
        response = await fetch(input, { ...init, headers });
      }
    }
    return response;
  }
}
