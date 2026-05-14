import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Result, Spin } from "antd";
import type { AdminSessionUser } from "@/types/auth";
import { fetchAdminSession } from "@/services/auth";
import { ApiError } from "@/services/apiClient";

interface AuthContextValue {
  user: AdminSessionUser | null;
  loading: boolean;
  hasPermission: (permission?: string | string[] | null) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminSession();
      setUser(result.admin);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          window.location.href = "/admin/login";
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
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" tip="正在加载后台会话..." />
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
          extra={
            <a href="/api/xhunt/stats" style={{ color: "#2563eb" }}>
              返回旧版后台
            </a>
          }
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
