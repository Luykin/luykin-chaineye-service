import type { XHuntAuthStorageValue, XHuntTokenSet, XHuntAuthUser } from "./types";

export const DEFAULT_STORAGE_KEY = "xhunt_auth_token";

function canUseDOM() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export class XHuntAuthStorage {
  private key: string;

  constructor(key = DEFAULT_STORAGE_KEY) {
    this.key = key;
  }

  read(): XHuntAuthStorageValue | null {
    if (!canUseDOM()) return null;
    const raw = window.localStorage.getItem(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as XHuntAuthStorageValue;
    } catch (_) {
      window.localStorage.removeItem(this.key);
      return null;
    }
  }

  write(token: XHuntTokenSet, userSnapshot?: XHuntAuthUser | null) {
    if (!canUseDOM()) return;
    const payload: XHuntAuthStorageValue = {
      ...token,
      userSnapshot: userSnapshot ?? token.userSnapshot ?? null,
    };
    window.localStorage.setItem(this.key, JSON.stringify(payload));
  }

  clear() {
    if (!canUseDOM()) return;
    window.localStorage.removeItem(this.key);
  }

  getKey() {
    return this.key;
  }
}
