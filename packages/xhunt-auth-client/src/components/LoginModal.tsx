import React, { FormEvent, useMemo, useState } from "react";
import { useXHuntAuth } from "../react/hooks";
import type { XHuntAuthError, XHuntAuthProviderName } from "../types";
import "../styles/xhunt-auth.css";

export interface XHuntLoginModalProps {
  open?: boolean;
  onClose?: () => void;
  enabledProviders?: XHuntAuthProviderName[];
  title?: string;
  subtitle?: string;
}

const DEFAULT_PROVIDERS: XHuntAuthProviderName[] = ["password", "google", "twitter", "evm"];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M18.9 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H2.33l7.73-8.84L1.91 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.74 4.13H5.77l11.97 15.64Z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4.75 5.5h13.1c1.52 0 2.75 1.23 2.75 2.75v.45h-5.2c-2.04 0-3.7 1.66-3.7 3.7s1.66 3.7 3.7 3.7h5.2v.65c0 1.52-1.23 2.75-2.75 2.75H4.75A3.75 3.75 0 0 1 1 15.75v-6.5A3.75 3.75 0 0 1 4.75 5.5Z" />
      <path fill="currentColor" d="M15.4 10.45h6.1c.28 0 .5.22.5.5v2.9c0 .28-.22.5-.5.5h-6.1a1.95 1.95 0 1 1 0-3.9Zm.1 2.65a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4Z" opacity=".72" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <>
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />
        </>
      ) : (
        <>
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 3l18 18" />
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M10.6 5.6c.46-.07.93-.1 1.4-.1 6.1 0 9.5 6.5 9.5 6.5a16.7 16.7 0 0 1-2.68 3.44M6.44 6.92C3.9 8.7 2.5 12 2.5 12s3.4 6.5 9.5 6.5c1.7 0 3.2-.5 4.46-1.2" />
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9.9 9.9a2.8 2.8 0 0 0 3.96 3.96" />
        </>
      )}
    </svg>
  );
}

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACCOUNT_OR_PASSWORD: "账号或密码不正确，请重新输入。",
  INVALID_ACCOUNT_NAME: "账号格式不正确，请输入邮箱，或 3-32 位字母、数字、下划线、短横线。",
  INVALID_PASSWORD_LENGTH: "密码长度需要在 8-128 位之间。",
  ACCOUNT_NAME_ALREADY_EXISTS: "这个账号已经被注册，请直接登录或换一个账号。",
  ACCOUNT_NAME_RESERVED: "这个账号名称暂不可使用，请换一个。",
  USER_DISABLED: "当前账号已被禁用，请联系管理员。",
  ACCOUNT_LOCKED: "密码错误次数过多，账号已临时锁定，请 15 分钟后再试。",
  INVALID_EVM_ADDRESS: "钱包地址格式不正确，请检查后重试。",
  CHALLENGE_NOT_FOUND_OR_EXPIRED: "钱包验证已过期，请重新发起登录。",
  MESSAGE_MISMATCH: "钱包签名消息不匹配，请重新发起登录。",
  ADDRESS_MISMATCH: "签名钱包地址不一致，请切换到正确的钱包。",
  INVALID_OR_EXPIRED_STATE: "登录状态已过期，请重新发起第三方登录。",
  GOOGLE_OAUTH_NOT_CONFIGURED: "Google 登录暂未配置，请稍后再试。",
  TOKEN_REQUIRED: "登录状态不存在，请重新登录。",
  TOKEN_INVALID: "登录状态无效，请重新登录。",
  TOKEN_EXPIRED: "登录已过期，请重新登录。",
  TOKEN_REPLACED: "你的账号已在其他地方重新登录，请刷新后重试。",
  REFRESH_TOKEN_INVALID: "登录状态已失效，请重新登录。",
  PROVIDER_ALREADY_BOUND_TO_USER: "当前账号已经绑定过这种登录方式。",
  IDENTITY_ALREADY_BOUND: "这个登录方式已经绑定到其他账号。",
  PASSWORD_ALREADY_SET: "当前账号已经设置过密码。",
  CANNOT_UNBIND_LAST_IDENTITY: "至少需要保留一种登录方式，不能解绑最后一个身份。",
  IDENTITY_NOT_FOUND: "没有找到对应的绑定身份。",
  MISSING_API_BASE_URL: "认证服务地址未配置。",
  MISSING_CLIENT_KEY: "应用 Client Key 未配置。",
  NETWORK_ERROR: "网络连接失败，请检查网络后重试。",
  UNKNOWN_ERROR: "操作失败，请稍后重试。",
  AUTH_CENTER_ERROR: "认证服务异常，请稍后重试。",
  PASSWORD_LOGIN_FAILED: "登录失败，请检查账号密码后重试。",
  PASSWORD_REGISTER_FAILED: "注册失败，请检查账号和密码后重试。",
  WALLET_LOGIN_FAILED: "钱包登录失败，请重新签名后重试。",
  GOOGLE_LOGIN_FAILED: "Google 登录失败，请重新授权后重试。",
  TWITTER_LOGIN_FAILED: "Twitter / X 登录失败，请重新授权后重试。",
  HTTP_429: "操作太频繁，请稍后再试。",
  HTTP_500: "服务暂时异常，请稍后再试。",
  HTTP_502: "服务暂时不可用，请稍后再试。",
  HTTP_503: "服务暂时不可用，请稍后再试。",
};

function isAuthError(error: unknown): error is XHuntAuthError {
  return !!error && typeof error === "object" && "code" in error;
}

function formatAuthError(error: unknown) {
  if (!error) return "操作失败，请稍后重试。";
  if (typeof error === "string") return FRIENDLY_ERROR_MESSAGES[error] || error;
  if (isAuthError(error)) {
    return FRIENDLY_ERROR_MESSAGES[error.code] || error.payload?.message || error.message || "操作失败，请稍后重试。";
  }
  if (error instanceof Error) {
    return FRIENDLY_ERROR_MESSAGES[error.message] || error.message || "操作失败，请稍后重试。";
  }
  return "操作失败，请稍后重试。";
}

export function XHuntLoginModal(props: XHuntLoginModalProps) {
  const auth = useXHuntAuth();
  const open = props.open ?? auth.isLoginModalOpen;
  const onClose = props.onClose ?? auth.closeLoginModal;
  const enabledProviders = props.enabledProviders || DEFAULT_PROVIDERS;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
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
      setLocalError(formatAuthError(error));
    }
  }

  async function run(action: () => Promise<unknown>) {
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(formatAuthError(error));
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
              <span>Account name or email</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                autoComplete="username"
                placeholder="name@company.com"
              />
            </label>
            <label>
              <span>Password</span>
              <div className="xhunt-auth-password-field">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={passwordVisible ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="xhunt-auth-password-toggle"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  <EyeIcon open={passwordVisible} />
                </button>
              </div>
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
              <span className="xhunt-auth-provider-icon google"><GoogleIcon /></span> Google
            </button>
          )}
          {providerSet.has("twitter") && (
            <button onClick={() => run(auth.loginWithTwitter)} disabled={auth.isLoading}>
              <span className="xhunt-auth-provider-icon twitter"><XIcon /></span> Twitter / X
            </button>
          )}
          {providerSet.has("evm") && (
            <button onClick={() => run(auth.loginWithWallet)} disabled={auth.isLoading}>
              <span className="xhunt-auth-provider-icon wallet"><WalletIcon /></span> EVM wallet
            </button>
          )}
        </div>

        {(localError || auth.error) && <p className="xhunt-auth-error">{localError || formatAuthError(auth.error)}</p>}
      </section>
    </div>
  );
}
