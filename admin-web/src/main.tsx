import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import { AuthProvider } from "./app/auth";
import { AdminThemeContext, ADMIN_THEME_STORAGE_KEY, type AdminEffectiveTheme, type AdminThemeMode } from "./app/theme";
import "./styles/global.css";

dayjs.locale("zh-cn");


function getSystemTheme(): AdminEffectiveTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialThemeMode(): AdminThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "light";
}

function AdminThemeProviders() {
  const [mode, setModeState] = useState<AdminThemeMode>(getInitialThemeMode);
  const [systemTheme, setSystemTheme] = useState<AdminEffectiveTheme>(getSystemTheme);
  const effectiveMode = mode === "system" ? systemTheme : mode;

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(query.matches ? "dark" : "light");
    handleChange();
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveMode;
    document.documentElement.style.colorScheme = effectiveMode;
  }, [effectiveMode]);

  const setMode = useCallback((nextMode: AdminThemeMode) => {
    setModeState(nextMode);
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextMode);
  }, []);

  const themeValue = useMemo(
    () => ({
      mode,
      effectiveMode,
      setMode,
      toggleMode: () => setMode(effectiveMode === "dark" ? "light" : "dark"),
    }),
    [effectiveMode, mode, setMode],
  );

  return (
    <AdminThemeContext.Provider value={themeValue}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: effectiveMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: effectiveMode === "dark" ? "#60a5fa" : "#2563eb",
            borderRadius: 10,
            colorBgLayout: effectiveMode === "dark" ? "#070b14" : "#f5f8fc",
            colorBgContainer: effectiveMode === "dark" ? "#111827" : "#ffffff",
            colorBgElevated: effectiveMode === "dark" ? "#182235" : "#ffffff",
            colorBgSpotlight: effectiveMode === "dark" ? "#1f2a44" : "#1f2937",
            colorBorder: effectiveMode === "dark" ? "#334155" : "#e5e7eb",
            colorSplit: effectiveMode === "dark" ? "#253246" : "#eef2f7",
            colorFillAlter: effectiveMode === "dark" ? "#172033" : "#f8fafc",
            colorFillSecondary: effectiveMode === "dark" ? "#1e293b" : "#f1f5f9",
            colorTextBase: effectiveMode === "dark" ? "#e5edf8" : "#1f2937",
            colorText: effectiveMode === "dark" ? "#e5edf8" : "#1f2937",
            colorTextSecondary: effectiveMode === "dark" ? "#a8b3c7" : "#64748b",
            colorTextTertiary: effectiveMode === "dark" ? "#7f8da3" : "#94a3b8",
            fontSize: 14,
          },
        }}
      >
        <AntdApp>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </QueryClientProvider>
        </AntdApp>
      </ConfigProvider>
    </AdminThemeContext.Provider>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

class AdminErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[AdminErrorBoundary] Uncaught render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "#070b14",
            color: "#e5edf8",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ maxWidth: 520, textAlign: "center" }}>
            <h2 style={{ fontSize: 20, marginBottom: 12 }}>管理后台加载异常</h2>
            <p style={{ color: "#94a3b8", marginBottom: 20, wordBreak: "break-word" }}>
              {this.state.error?.message || "发生了未预期的渲染错误"}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 24px",
                backgroundColor: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminErrorBoundary>
      <AdminThemeProviders />
    </AdminErrorBoundary>
  </React.StrictMode>
);
