import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Result, Spin } from "antd";
import type { AdminSessionErrorResponse, AdminSessionUser } from "@/types/auth";
import { fetchAdminSession } from "@/services/auth";
import { ApiError } from "@/services/apiClient";

const ADMIN_ENTRY_PATH = "/api/xhunt/stats";
const ADMIN_HOME_PATH = "/overview";
const ADMIN_LOGIN_HASH = "#/login";

function getCurrentHash() {
  return window.location.hash || "#/";
}

function isLoginHash(hash: string) {
  return hash.startsWith(ADMIN_LOGIN_HASH);
}

function buildLoginUrl() {
  return `${ADMIN_ENTRY_PATH}${ADMIN_LOGIN_HASH}?next=${encodeURIComponent(ADMIN_HOME_PATH)}`;
}

interface AuthContextValue {
  user: AdminSessionUser | null;
  loading: boolean;
  hasPermission: (permission?: string | string[] | null) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentHash, setCurrentHash] = useState(getCurrentHash);
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [loading, setLoading] = useState(() => !isLoginHash(getCurrentHash()));
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const isLoginRoute = isLoginHash(currentHash);

  useEffect(() => {
    const syncHash = () => setCurrentHash(getCurrentHash());
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, []);

  const load = async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminSession();
      if (requestSeqRef.current !== requestSeq) return;
      setUser(result.admin);
    } catch (err: unknown) {
      if (requestSeqRef.current !== requestSeq) return;
      setUser(null);
      if (err instanceof ApiError) {
        const errorData = (typeof err.data === "object" && err.data
          ? (err.data as AdminSessionErrorResponse)
          : null);

        if (err.status === 401 || (err.status === 403 && errorData?.needLogin)) {
          window.location.href = buildLoginUrl();
          return;
        }
        if (err.status === 403) {
          setError("当前账号无权访问新的管理后台。");
        } else {
          setError(err.message);
        }
      } else {
        setError("加载管理员会话失败");
      }
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isLoginRoute) {
      requestSeqRef.current += 1;
      setUser(null);
      setError(null);
      setLoading(false);
      return;
    }
    void load();
  }, [isLoginRoute, currentHash]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      hasPermission(permission) {
        if (!user) return false;
        if (user.role === "super") return true;
        const permissions = Array.isArray(user.permissions) ? user.permissions : [];
        if (permissions.includes("*")) return true;
        if (!permission) return true;
        if (Array.isArray(permission)) {
          return permission.some((item) => permissions.includes(item));
        }
        return permissions.includes(permission);
      },
      refresh: load,
    }),
    [user, loading]
  );

  if (loading || (!isLoginRoute && !user && !error)) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" fullscreen tip="正在加载后台会话..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <Result
          status="403"
          title="无法进入新后台"
          subTitle={error}
        />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内部使用");
  }
  return context;
}
