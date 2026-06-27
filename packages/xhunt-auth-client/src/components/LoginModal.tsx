import React, { FormEvent, useMemo, useState } from "react";
import { useXHuntAuth } from "../react/hooks";
import type { XHuntAuthError, XHuntAuthLocale, XHuntAuthProviderName, XHuntAuthTextOverrides } from "../types";
import "../styles/xhunt-auth.css";

export interface XHuntLoginModalProps {
  open?: boolean;
  onClose?: () => void;
  enabledProviders?: XHuntAuthProviderName[];
  locale?: XHuntAuthLocale;
  texts?: XHuntAuthTextOverrides;
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

type BuiltInLocale = "en" | "zh-CN" | "zh-TW";
type LoginModalTexts = Omit<Required<XHuntAuthTextOverrides>, "errors"> & {
  errors: Record<string, string>;
};

const ERROR_MESSAGES_EN: Record<string, string> = {
  INVALID_ACCOUNT_OR_PASSWORD: "The account or password is incorrect.",
  INVALID_ACCOUNT_NAME: "Use an email address, or 3-32 letters, numbers, underscores, or hyphens.",
  INVALID_PASSWORD_LENGTH: "Password must be 8-128 characters.",
  ACCOUNT_NAME_ALREADY_EXISTS: "This account is already registered. Sign in or choose another name.",
  ACCOUNT_NAME_RESERVED: "This account name is not available. Please choose another one.",
  USER_DISABLED: "This account has been disabled. Please contact support.",
  ACCOUNT_LOCKED: "Too many failed attempts. Please try again in 15 minutes.",
  INVALID_EVM_ADDRESS: "The wallet address is invalid.",
  CHALLENGE_NOT_FOUND_OR_EXPIRED: "Wallet verification expired. Please start again.",
  MESSAGE_MISMATCH: "The wallet signature message does not match. Please start again.",
  ADDRESS_MISMATCH: "The signed wallet address does not match. Please switch wallets.",
  INVALID_OR_EXPIRED_STATE: "This sign-in session expired. Please try again.",
  GOOGLE_OAUTH_NOT_CONFIGURED: "Google sign-in is not configured yet.",
  TOKEN_REQUIRED: "Please sign in again.",
  TOKEN_INVALID: "Your session is invalid. Please sign in again.",
  TOKEN_EXPIRED: "Your session has expired. Please sign in again.",
  TOKEN_REPLACED: "Your account signed in somewhere else. Please refresh and try again.",
  REFRESH_TOKEN_INVALID: "Your session is no longer valid. Please sign in again.",
  TRANSFER_CODE_INVALID: "Secure handoff expired. Please sign in again.",
  PROVIDER_ALREADY_BOUND_TO_USER: "This sign-in method is already linked to your account.",
  IDENTITY_ALREADY_BOUND: "This sign-in method is already linked to another account.",
  PASSWORD_ALREADY_SET: "Password sign-in is already enabled for this account.",
  CANNOT_UNBIND_LAST_IDENTITY: "Keep at least one sign-in method linked to your account.",
  IDENTITY_NOT_FOUND: "This linked identity was not found.",
  MISSING_API_BASE_URL: "Auth service URL is missing.",
  MISSING_CLIENT_KEY: "Client key is missing.",
  NETWORK_ERROR: "Network error. Check your connection and try again.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
  AUTH_CENTER_ERROR: "Auth service is temporarily unavailable. Please try again later.",
  PASSWORD_LOGIN_FAILED: "Sign-in failed. Check your account and password.",
  PASSWORD_REGISTER_FAILED: "Account creation failed. Check your account name and password.",
  PASSWORD_BIND_FAILED: "Password setup failed. Please try again.",
  WALLET_NONCE_FAILED: "Could not start wallet verification. Please try again.",
  WALLET_LOGIN_FAILED: "Wallet sign-in failed. Please sign again.",
  EVM_BIND_FAILED: "Wallet linking failed. Please sign again.",
  GOOGLE_AUTH_URL_FAILED: "Could not start Google sign-in. Please try again.",
  GOOGLE_LOGIN_FAILED: "Google sign-in failed. Please authorize again.",
  GOOGLE_BIND_URL_FAILED: "Could not start Google linking. Please try again.",
  GOOGLE_BIND_FAILED: "Google linking failed. Please authorize again.",
  TWITTER_AUTH_URL_FAILED: "Could not start Twitter / X sign-in. Please try again.",
  TWITTER_LOGIN_FAILED: "Twitter / X sign-in failed. Please authorize again.",
  TWITTER_BIND_URL_FAILED: "Could not start Twitter / X linking. Please try again.",
  TWITTER_BIND_FAILED: "Twitter / X linking failed. Please authorize again.",
  UNBIND_IDENTITY_FAILED: "Could not unlink this sign-in method. Please try again.",
  TOKEN_REFRESH_FAILED: "Could not refresh your session. Please sign in again.",
  TRANSFER_CODE_EXCHANGE_FAILED: "Secure handoff failed. Please sign in again.",
  LOGOUT_FAILED: "Could not sign out. Please try again.",
  LOGOUT_ALL_FAILED: "Could not sign out from all devices. Please try again.",
  OAUTH_CALLBACK_MISSING_CODE_OR_STATE: "Missing OAuth callback information. Please sign in again.",
  WALLET_NOT_FOUND: "No EVM wallet was found in this browser.",
  WALLET_ACCOUNT_NOT_SELECTED: "No wallet account was selected.",
  HTTP_400: "The request is invalid. Please refresh and try again.",
  HTTP_401: "Please sign in again.",
  HTTP_403: "You do not have access to this action.",
  HTTP_404: "The auth endpoint was not found.",
  HTTP_419: "Your session expired. Please sign in again.",
  HTTP_429: "Too many attempts. Please try again later.",
  HTTP_500: "Service error. Please try again later.",
  HTTP_502: "Service is temporarily unavailable. Please try again later.",
  HTTP_503: "Service is temporarily unavailable. Please try again later.",
  WEB_SIGNATURE_REQUIRED: "Request signature is missing. Please refresh and try again.",
  WEB_SIGNATURE_VERSION_UNSUPPORTED: "Auth component version mismatch. Please refresh and try again.",
  WEB_SIGNATURE_EXPIRED: "Request expired. Please refresh and try again.",
  WEB_SIGNATURE_REPLAYED: "This request was already processed. Please refresh and try again.",
  WEB_SIGNATURE_BODY_HASH_MISMATCH: "Request verification failed. Please refresh and try again.",
  WEB_SIGNATURE_INVALID: "Request signature is invalid. Please refresh and try again.",
  WEB_SIGNATURE_CLIENT_INVALID: "This app is not allowed to access the auth center.",
  WEB_SIGNATURE_ORIGIN_DENIED: "This page origin is not allowed to access the auth center.",
  WEB_SIGNATURE_CONFIG_MISSING: "Auth center signature config is missing. Please contact support.",
  WEB_SIGNATURE_SALT_MISSING: "Auth component signature config is missing. Please contact support.",
  WEB_SIGNATURE_CRYPTO_UNAVAILABLE: "This browser does not support secure signing. Please use another browser.",
};

const ERROR_MESSAGES_ZH_CN: Record<string, string> = {
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
  TRANSFER_CODE_INVALID: "登录跳转凭证已过期，请重新登录。",
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
  PASSWORD_BIND_FAILED: "设置密码失败，请稍后重试。",
  WALLET_NONCE_FAILED: "钱包验证发起失败，请稍后重试。",
  WALLET_LOGIN_FAILED: "钱包登录失败，请重新签名后重试。",
  EVM_BIND_FAILED: "钱包绑定失败，请重新签名后重试。",
  GOOGLE_AUTH_URL_FAILED: "Google 登录发起失败，请稍后重试。",
  GOOGLE_LOGIN_FAILED: "Google 登录失败，请重新授权后重试。",
  GOOGLE_BIND_URL_FAILED: "Google 绑定发起失败，请稍后重试。",
  GOOGLE_BIND_FAILED: "Google 绑定失败，请重新授权后重试。",
  TWITTER_AUTH_URL_FAILED: "Twitter / X 登录发起失败，请稍后重试。",
  TWITTER_LOGIN_FAILED: "Twitter / X 登录失败，请重新授权后重试。",
  TWITTER_BIND_URL_FAILED: "Twitter / X 绑定发起失败，请稍后重试。",
  TWITTER_BIND_FAILED: "Twitter / X 绑定失败，请重新授权后重试。",
  UNBIND_IDENTITY_FAILED: "解绑失败，请稍后重试。",
  TOKEN_REFRESH_FAILED: "登录状态刷新失败，请重新登录。",
  TRANSFER_CODE_EXCHANGE_FAILED: "登录跳转失败，请重新登录。",
  LOGOUT_FAILED: "退出登录失败，请稍后重试。",
  LOGOUT_ALL_FAILED: "退出全部设备失败，请稍后重试。",
  OAUTH_CALLBACK_MISSING_CODE_OR_STATE: "第三方登录回调信息缺失，请重新登录。",
  WALLET_NOT_FOUND: "当前浏览器没有检测到 EVM 钱包。",
  WALLET_ACCOUNT_NOT_SELECTED: "未选择钱包账号。",
  HTTP_400: "请求格式不正确，请刷新后重试。",
  HTTP_401: "请重新登录。",
  HTTP_403: "当前账号无权进行此操作。",
  HTTP_404: "认证接口不存在。",
  HTTP_419: "登录已过期，请重新登录。",
  HTTP_429: "操作太频繁，请稍后再试。",
  HTTP_500: "服务暂时异常，请稍后再试。",
  HTTP_502: "服务暂时不可用，请稍后再试。",
  HTTP_503: "服务暂时不可用，请稍后再试。",
  WEB_SIGNATURE_REQUIRED: "请求签名缺失，请刷新页面后重试。",
  WEB_SIGNATURE_VERSION_UNSUPPORTED: "认证组件版本不匹配，请刷新页面后重试。",
  WEB_SIGNATURE_EXPIRED: "请求已过期，请刷新页面后重试。",
  WEB_SIGNATURE_REPLAYED: "请求已处理，请刷新后重试。",
  WEB_SIGNATURE_BODY_HASH_MISMATCH: "请求内容校验失败，请刷新后重试。",
  WEB_SIGNATURE_INVALID: "请求签名无效，请刷新页面后重试。",
  WEB_SIGNATURE_CLIENT_INVALID: "当前应用未授权访问认证中心。",
  WEB_SIGNATURE_ORIGIN_DENIED: "当前页面来源不允许访问认证中心。",
  WEB_SIGNATURE_CONFIG_MISSING: "认证中心签名配置缺失，请联系管理员。",
  WEB_SIGNATURE_SALT_MISSING: "认证组件签名配置缺失，请联系管理员。",
  WEB_SIGNATURE_CRYPTO_UNAVAILABLE: "当前浏览器不支持安全签名，请更换浏览器后重试。",
};

const ERROR_MESSAGES_ZH_TW: Record<string, string> = {
  INVALID_ACCOUNT_OR_PASSWORD: "帳號或密碼不正確，請重新輸入。",
  INVALID_ACCOUNT_NAME: "帳號格式不正確，請輸入電子郵件，或 3-32 位字母、數字、底線、連字號。",
  INVALID_PASSWORD_LENGTH: "密碼長度需要在 8-128 位之間。",
  ACCOUNT_NAME_ALREADY_EXISTS: "這個帳號已經被註冊，請直接登入或換一個帳號。",
  ACCOUNT_NAME_RESERVED: "這個帳號名稱暫不可使用，請換一個。",
  USER_DISABLED: "目前帳號已被停用，請聯絡管理員。",
  ACCOUNT_LOCKED: "密碼錯誤次數過多，帳號已暫時鎖定，請 15 分鐘後再試。",
  INVALID_EVM_ADDRESS: "錢包地址格式不正確，請檢查後重試。",
  CHALLENGE_NOT_FOUND_OR_EXPIRED: "錢包驗證已過期，請重新發起登入。",
  MESSAGE_MISMATCH: "錢包簽名訊息不匹配，請重新發起登入。",
  ADDRESS_MISMATCH: "簽名錢包地址不一致，請切換到正確的錢包。",
  INVALID_OR_EXPIRED_STATE: "登入狀態已過期，請重新發起第三方登入。",
  GOOGLE_OAUTH_NOT_CONFIGURED: "Google 登入暫未配置，請稍後再試。",
  TOKEN_REQUIRED: "登入狀態不存在，請重新登入。",
  TOKEN_INVALID: "登入狀態無效，請重新登入。",
  TOKEN_EXPIRED: "登入已過期，請重新登入。",
  TOKEN_REPLACED: "你的帳號已在其他地方重新登入，請重新整理後重試。",
  REFRESH_TOKEN_INVALID: "登入狀態已失效，請重新登入。",
  TRANSFER_CODE_INVALID: "登入跳轉憑證已過期，請重新登入。",
  PROVIDER_ALREADY_BOUND_TO_USER: "目前帳號已經綁定過這種登入方式。",
  IDENTITY_ALREADY_BOUND: "這個登入方式已經綁定到其他帳號。",
  PASSWORD_ALREADY_SET: "目前帳號已經設定過密碼。",
  CANNOT_UNBIND_LAST_IDENTITY: "至少需要保留一種登入方式，不能解除綁定最後一個身份。",
  IDENTITY_NOT_FOUND: "沒有找到對應的綁定身份。",
  MISSING_API_BASE_URL: "認證服務地址未配置。",
  MISSING_CLIENT_KEY: "應用 Client Key 未配置。",
  NETWORK_ERROR: "網路連線失敗，請檢查網路後重試。",
  UNKNOWN_ERROR: "操作失敗，請稍後重試。",
  AUTH_CENTER_ERROR: "認證服務異常，請稍後重試。",
  PASSWORD_LOGIN_FAILED: "登入失敗，請檢查帳號密碼後重試。",
  PASSWORD_REGISTER_FAILED: "註冊失敗，請檢查帳號和密碼後重試。",
  PASSWORD_BIND_FAILED: "設定密碼失敗，請稍後重試。",
  WALLET_NONCE_FAILED: "錢包驗證發起失敗，請稍後重試。",
  WALLET_LOGIN_FAILED: "錢包登入失敗，請重新簽名後重試。",
  EVM_BIND_FAILED: "錢包綁定失敗，請重新簽名後重試。",
  GOOGLE_AUTH_URL_FAILED: "Google 登入發起失敗，請稍後重試。",
  GOOGLE_LOGIN_FAILED: "Google 登入失敗，請重新授權後重試。",
  GOOGLE_BIND_URL_FAILED: "Google 綁定發起失敗，請稍後重試。",
  GOOGLE_BIND_FAILED: "Google 綁定失敗，請重新授權後重試。",
  TWITTER_AUTH_URL_FAILED: "Twitter / X 登入發起失敗，請稍後重試。",
  TWITTER_LOGIN_FAILED: "Twitter / X 登入失敗，請重新授權後重試。",
  TWITTER_BIND_URL_FAILED: "Twitter / X 綁定發起失敗，請稍後重試。",
  TWITTER_BIND_FAILED: "Twitter / X 綁定失敗，請重新授權後重試。",
  UNBIND_IDENTITY_FAILED: "解除綁定失敗，請稍後重試。",
  TOKEN_REFRESH_FAILED: "登入狀態刷新失敗，請重新登入。",
  TRANSFER_CODE_EXCHANGE_FAILED: "登入跳轉失敗，請重新登入。",
  LOGOUT_FAILED: "登出失敗，請稍後重試。",
  LOGOUT_ALL_FAILED: "登出全部裝置失敗，請稍後重試。",
  OAUTH_CALLBACK_MISSING_CODE_OR_STATE: "第三方登入回調資訊缺失，請重新登入。",
  WALLET_NOT_FOUND: "目前瀏覽器沒有偵測到 EVM 錢包。",
  WALLET_ACCOUNT_NOT_SELECTED: "未選擇錢包帳號。",
  HTTP_400: "請求格式不正確，請重新整理後重試。",
  HTTP_401: "請重新登入。",
  HTTP_403: "目前帳號無權進行此操作。",
  HTTP_404: "認證介面不存在。",
  HTTP_419: "登入已過期，請重新登入。",
  HTTP_429: "操作太頻繁，請稍後再試。",
  HTTP_500: "服務暫時異常，請稍後再試。",
  HTTP_502: "服務暫時不可用，請稍後再試。",
  HTTP_503: "服務暫時不可用，請稍後再試。",
  WEB_SIGNATURE_REQUIRED: "請求簽名缺失，請重新整理頁面後重試。",
  WEB_SIGNATURE_VERSION_UNSUPPORTED: "認證元件版本不匹配，請重新整理頁面後重試。",
  WEB_SIGNATURE_EXPIRED: "請求已過期，請重新整理頁面後重試。",
  WEB_SIGNATURE_REPLAYED: "請求已處理，請重新整理後重試。",
  WEB_SIGNATURE_BODY_HASH_MISMATCH: "請求內容校驗失敗，請重新整理後重試。",
  WEB_SIGNATURE_INVALID: "請求簽名無效，請重新整理頁面後重試。",
  WEB_SIGNATURE_CLIENT_INVALID: "目前應用未授權存取認證中心。",
  WEB_SIGNATURE_ORIGIN_DENIED: "目前頁面來源不允許存取認證中心。",
  WEB_SIGNATURE_CONFIG_MISSING: "認證中心簽名配置缺失，請聯絡管理員。",
  WEB_SIGNATURE_SALT_MISSING: "認證元件簽名配置缺失，請聯絡管理員。",
  WEB_SIGNATURE_CRYPTO_UNAVAILABLE: "目前瀏覽器不支援安全簽名，請更換瀏覽器後重試。",
};

const LOGIN_TEXTS: Record<BuiltInLocale, LoginModalTexts> = {
  en: {
    authCenterKicker: "XHunt Auth Center",
    title: "Sign in to XHunt",
    subtitle: "One account for every XHunt web experience.",
    loginTab: "Login",
    createTab: "Create",
    accountLabel: "Account name or email",
    accountPlaceholder: "name@company.com",
    passwordLabel: "Password",
    passwordPlaceholder: "••••••••",
    continueButton: "Continue",
    createAccountButton: "Create account",
    divider: "or use a verified identity",
    googleButton: "Google",
    twitterButton: "Twitter / X",
    walletButton: "EVM wallet",
    closeLabel: "Close",
    showPasswordLabel: "Show password",
    hidePasswordLabel: "Hide password",
    genericError: "Something went wrong. Please try again.",
    errors: ERROR_MESSAGES_EN,
  },
  "zh-CN": {
    authCenterKicker: "XHunt 认证中心",
    title: "登录 XHunt",
    subtitle: "一个账号，访问所有 XHunt Web 服务。",
    loginTab: "登录",
    createTab: "注册",
    accountLabel: "账号名或邮箱",
    accountPlaceholder: "name@company.com",
    passwordLabel: "密码",
    passwordPlaceholder: "••••••••",
    continueButton: "继续",
    createAccountButton: "创建账号",
    divider: "或使用已验证身份",
    googleButton: "Google",
    twitterButton: "Twitter / X",
    walletButton: "EVM 钱包",
    closeLabel: "关闭",
    showPasswordLabel: "显示密码",
    hidePasswordLabel: "隐藏密码",
    genericError: "操作失败，请稍后重试。",
    errors: ERROR_MESSAGES_ZH_CN,
  },
  "zh-TW": {
    authCenterKicker: "XHunt 認證中心",
    title: "登入 XHunt",
    subtitle: "一個帳號，存取所有 XHunt Web 服務。",
    loginTab: "登入",
    createTab: "註冊",
    accountLabel: "帳號名稱或電子郵件",
    accountPlaceholder: "name@company.com",
    passwordLabel: "密碼",
    passwordPlaceholder: "••••••••",
    continueButton: "繼續",
    createAccountButton: "建立帳號",
    divider: "或使用已驗證身份",
    googleButton: "Google",
    twitterButton: "Twitter / X",
    walletButton: "EVM 錢包",
    closeLabel: "關閉",
    showPasswordLabel: "顯示密碼",
    hidePasswordLabel: "隱藏密碼",
    genericError: "操作失敗，請稍後重試。",
    errors: ERROR_MESSAGES_ZH_TW,
  },
};

function resolveBuiltInLocale(locale?: XHuntAuthLocale): BuiltInLocale {
  const normalized = String(locale || "en").toLowerCase();
  if (normalized === "zh-cn" || normalized === "zh-hans" || normalized.startsWith("zh-cn")) return "zh-CN";
  if (
    normalized === "zh-tw" ||
    normalized === "zh-hant" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo" ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo")
  ) {
    return "zh-TW";
  }
  return "en";
}

function mergeTextOverrides(base: LoginModalTexts, ...overrides: Array<XHuntAuthTextOverrides | undefined>): LoginModalTexts {
  return overrides.reduce<LoginModalTexts>((current, override) => {
    if (!override) return current;
    const { errors, ...rest } = override;
    return {
      ...current,
      ...rest,
      errors: {
        ...current.errors,
        ...(errors || {}),
      },
    };
  }, base);
}

function resolveLoginTexts(
  locale?: XHuntAuthLocale,
  configTexts?: XHuntAuthTextOverrides,
  propTexts?: XHuntAuthTextOverrides
): LoginModalTexts {
  const builtInLocale = resolveBuiltInLocale(locale);
  return mergeTextOverrides(LOGIN_TEXTS[builtInLocale], configTexts, propTexts);
}

function isAuthError(error: unknown): error is XHuntAuthError {
  return !!error && typeof error === "object" && "code" in error;
}

function formatAuthError(error: unknown, texts: LoginModalTexts) {
  if (!error) return texts.genericError;
  if (typeof error === "string") return texts.errors[error] || error || texts.genericError;
  if (isAuthError(error)) {
    const payloadCode = typeof error.payload?.error === "string" ? error.payload.error : "";
    return texts.errors[error.code] || texts.errors[payloadCode] || error.payload?.message || texts.genericError;
  }
  if (error instanceof Error) {
    return texts.errors[error.message] || error.message || texts.genericError;
  }
  return texts.genericError;
}

export function XHuntLoginModal(props: XHuntLoginModalProps) {
  const auth = useXHuntAuth();
  const open = props.open ?? auth.isLoginModalOpen;
  const onClose = props.onClose ?? auth.closeLoginModal;
  const uiConfig = auth.client.config.ui;
  const enabledProviders = props.enabledProviders || uiConfig?.enabledProviders || DEFAULT_PROVIDERS;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const texts = useMemo(() => {
    const configTexts: XHuntAuthTextOverrides = { ...(uiConfig?.texts || {}) };
    const propTexts: XHuntAuthTextOverrides = { ...(props.texts || {}) };
    if (uiConfig?.title) configTexts.title = uiConfig.title;
    if (uiConfig?.subtitle) configTexts.subtitle = uiConfig.subtitle;
    if (props.title) propTexts.title = props.title;
    if (props.subtitle) propTexts.subtitle = props.subtitle;
    return resolveLoginTexts(props.locale || uiConfig?.locale, configTexts, propTexts);
  }, [props.locale, props.subtitle, props.texts, props.title, uiConfig?.locale, uiConfig?.subtitle, uiConfig?.texts, uiConfig?.title]);
  const title = texts.title;
  const subtitle = texts.subtitle;

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
      setLocalError(formatAuthError(error, texts));
    }
  }

  async function run(action: () => Promise<unknown>) {
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(formatAuthError(error, texts));
    }
  }

  return (
    <div className="xhunt-auth-shell" role="dialog" aria-modal="true" aria-label={title}>
      <button className="xhunt-auth-backdrop" aria-label={texts.closeLabel} onClick={onClose} />
      <section className="xhunt-auth-panel">
        <button className="xhunt-auth-close" aria-label={texts.closeLabel} onClick={onClose}>
          ×
        </button>

        <div className="xhunt-auth-brandline" />
        <header className="xhunt-auth-header">
          <p className="xhunt-auth-kicker">{texts.authCenterKicker}</p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </header>

        {providerSet.has("password") && (
          <form className="xhunt-auth-form" onSubmit={onPasswordSubmit}>
            <div className="xhunt-auth-mode-switch" role="tablist" aria-label={texts.passwordLabel}>
              <button type="button" data-active={mode === "login"} onClick={() => setMode("login")}>
                {texts.loginTab}
              </button>
              <button type="button" data-active={mode === "register"} onClick={() => setMode("register")}>
                {texts.createTab}
              </button>
            </div>
            <label>
              <span>{texts.accountLabel}</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                autoComplete="username"
                placeholder={texts.accountPlaceholder}
              />
            </label>
            <label>
              <span>{texts.passwordLabel}</span>
              <div className="xhunt-auth-password-field">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={passwordVisible ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={texts.passwordPlaceholder}
                />
                <button
                  type="button"
                  className="xhunt-auth-password-toggle"
                  aria-label={passwordVisible ? texts.hidePasswordLabel : texts.showPasswordLabel}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  <EyeIcon open={passwordVisible} />
                </button>
              </div>
            </label>
            <button className="xhunt-auth-primary" disabled={auth.isLoading} type="submit">
              {mode === "login" ? texts.continueButton : texts.createAccountButton}
            </button>
          </form>
        )}

        <div className="xhunt-auth-divider">
          <span>{texts.divider}</span>
        </div>

        <div className="xhunt-auth-providers">
          {providerSet.has("google") && (
            <button onClick={() => run(auth.loginWithGoogle)} disabled={auth.isLoading}>
              <span className="xhunt-auth-provider-icon google"><GoogleIcon /></span> {texts.googleButton}
            </button>
          )}
          {providerSet.has("twitter") && (
            <button onClick={() => run(auth.loginWithTwitter)} disabled={auth.isLoading}>
              <span className="xhunt-auth-provider-icon twitter"><XIcon /></span> {texts.twitterButton}
            </button>
          )}
          {providerSet.has("evm") && (
            <button onClick={() => run(auth.loginWithWallet)} disabled={auth.isLoading}>
              <span className="xhunt-auth-provider-icon wallet"><WalletIcon /></span> {texts.walletButton}
            </button>
          )}
        </div>

        {(localError || auth.error) && <p className="xhunt-auth-error">{localError || formatAuthError(auth.error, texts)}</p>}
      </section>
    </div>
  );
}
