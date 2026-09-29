import { useCallback, useEffect, useState } from "react";

const CURRENT_BUILD_ID = String(import.meta.env.VITE_ADMIN_WEB_BUILD_ID || "");
const VERSION_MANIFEST_URL = `${import.meta.env.BASE_URL}version.json`;
const VERSION_CHECK_INTERVAL_MS = 60_000;

async function fetchLatestBuildId() {
  const response = await fetch(`${VERSION_MANIFEST_URL}?_=${Date.now()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) return null;

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("buildId" in payload)) return null;

  const buildId = (payload as { buildId?: unknown }).buildId;
  return typeof buildId === "string" && buildId ? buildId : null;
}

export function useAdminWebUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (import.meta.env.DEV || updateAvailable || !CURRENT_BUILD_ID) return;

    try {
      const latestBuildId = await fetchLatestBuildId();
      if (latestBuildId && latestBuildId !== CURRENT_BUILD_ID) {
        setUpdateAvailable(true);
      }
    } catch {
      // 版本检查失败不能影响当前后台页面的正常使用。
    }
  }, [updateAvailable]);

  useEffect(() => {
    void checkForUpdate();
    const intervalId = window.setInterval(() => void checkForUpdate(), VERSION_CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkForUpdate]);

  return {
    updateAvailable,
    refresh: () => window.location.reload(),
  };
}
