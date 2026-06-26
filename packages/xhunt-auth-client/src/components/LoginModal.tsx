import React, { FormEvent, useMemo, useState } from "react";
import { useXHuntAuth } from "../react/hooks";
import type { XHuntAuthProviderName } from "../types";
import "../styles/xhunt-auth.css";

export interface XHuntLoginModalProps {
  open?: boolean;
  onClose?: () => void;
  enabledProviders?: XHuntAuthProviderName[];
  title?: string;
  subtitle?: string;
}

const DEFAULT_PROVIDERS: XHuntAuthProviderName[] = ["password", "google", "twitter", "evm"];

export function XHuntLoginModal(props: XHuntLoginModalProps) {
  const auth = useXHuntAuth();
  const open = props.open ?? auth.isLoginModalOpen;
  const onClose = props.onClose ?? auth.closeLoginModal;
  const enabledProviders = props.enabledProviders || DEFAULT_PROVIDERS;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const title = props.title || "Sign in to XHunt";
  const subtitle = props.subtitle || "One account for every XHunt web experience.";

  const providerSet = useMemo(() => new Set(enabledProviders), [enabledProviders]);

  if (!open) return null;

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    try {
      if (mode === "login") {
        await auth.loginWithPassword({ accountName, password });
      } else {
        await auth.registerWithPassword({ accountName, password });
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Login failed");
    }
  }

  async function run(action: () => Promise<unknown>) {
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Login failed");
    }
  }

  return (
    <div className="xhunt-auth-shell" role="dialog" aria-modal="true" aria-label={title}>
      <button className="xhunt-auth-backdrop" aria-label="Close login" onClick={onClose} />
      <section className="xhunt-auth-panel">
        <button className="xhunt-auth-close" aria-label="Close" onClick={onClose}>
          ×
        </button>

        <div className="xhunt-auth-brandline" />
        <header className="xhunt-auth-header">
          <p className="xhunt-auth-kicker">XHunt Auth Center</p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </header>

        {providerSet.has("password") && (
          <form className="xhunt-auth-form" onSubmit={onPasswordSubmit}>
            <div className="xhunt-auth-mode-switch" role="tablist" aria-label="Password mode">
              <button type="button" data-active={mode === "login"} onClick={() => setMode("login")}>
                Login
              </button>
              <button type="button" data-active={mode === "register"} onClick={() => setMode("register")}>
                Create
              </button>
            </div>
            <label>
              <span>Account name</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                autoComplete="username"
                placeholder="kunge"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••"
              />
            </label>
            <button className="xhunt-auth-primary" disabled={auth.isLoading} type="submit">
              {mode === "login" ? "Continue" : "Create account"}
            </button>
          </form>
        )}

        <div className="xhunt-auth-divider">
          <span>or use a verified identity</span>
        </div>

        <div className="xhunt-auth-providers">
          {providerSet.has("google") && (
            <button onClick={() => run(auth.loginWithGoogle)} disabled={auth.isLoading}>
              <span className="xhunt-auth-dot google" /> Google
            </button>
          )}
          {providerSet.has("twitter") && (
            <button onClick={() => run(auth.loginWithTwitter)} disabled={auth.isLoading}>
              <span className="xhunt-auth-dot twitter" /> Twitter / X
            </button>
          )}
          {providerSet.has("evm") && (
            <button onClick={() => run(auth.loginWithWallet)} disabled={auth.isLoading}>
              <span className="xhunt-auth-dot wallet" /> EVM wallet
            </button>
          )}
        </div>

        {(localError || auth.error) && <p className="xhunt-auth-error">{localError || auth.error?.message}</p>}
      </section>
    </div>
  );
}
