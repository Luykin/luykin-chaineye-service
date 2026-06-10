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
            colorPrimary: "#2563eb",
            borderRadius: 10,
            colorBgLayout: effectiveMode === "dark" ? "#0f172a" : "#f5f8fc",
            colorTextBase: effectiveMode === "dark" ? "#e5edf8" : "#1f2937",
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminThemeProviders />
  </React.StrictMode>
);
