import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "https://kb.cryptohunt.ai";
  const enableProxyLog = env.VITE_PROXY_LOG !== "false";
  console.log(`[vite-config] mode=${mode} proxyTarget=${target}`);

  function createProxyConfig(prefix: string) {
    return {
      target,
      changeOrigin: true,
      secure: false,
      configure: (proxy: any) => {
        if (!enableProxyLog) return;

        proxy.on("proxyReq", (proxyReq: any, req: any) => {
          console.log(
            `[vite-proxy:req] ${req.method} ${req.url} -> ${target}${req.url}`
          );
          const cookie = req.headers?.cookie;
          console.log(
            `[vite-proxy:req-headers] host=${req.headers?.host || "-"} cookie=${
              cookie ? `present(${String(cookie).length})` : "missing"
            }`
          );
        });

        proxy.on("proxyRes", (proxyRes: any, req: any) => {
          console.log(
            `[vite-proxy:res] ${req.method} ${req.url} <- ${proxyRes.statusCode}`
          );
          const setCookie = proxyRes.headers?.["set-cookie"];
          if (setCookie) {
            console.log(
              `[vite-proxy:res-headers] set-cookie=${Array.isArray(setCookie) ? setCookie.length : 1}`
            );
          }
        });

        proxy.on("error", (err: any, req: any) => {
          console.error(
            `[vite-proxy:error] ${req?.method || "UNKNOWN"} ${req?.url || "-"} -> ${target}`
          );
          console.error(err);
        });
      },
    };
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: Number(env.VITE_PORT || 5174),
      proxy: {
        "/api": createProxyConfig("/api"),
        "/admin": createProxyConfig("/admin"),
      },
    },
  };
});
