import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = env.VITE_API_BASE_URL || "";
  const devDomain = env.VITE_DEV_DOMAIN || "";
  const port = Number(env.VITE_PORT || 5174);
  console.log(`[vite-config] mode=${mode} apiBaseUrl=${apiBaseUrl}`);

  return {
    base: mode === "production" ? "/static/admin-web/" : "/",
    publicDir: mode === "production" ? false : "public",
    plugins: [react()],
    build: {
      outDir: "public/static/admin-web",
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        react: path.resolve(__dirname, "node_modules/react"),
        "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
        "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      },
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      ...(devDomain
        ? {
            allowedHosts: [devDomain],
            hmr: {
              host: devDomain,
              protocol: "wss",
              clientPort: 443,
            },
          }
        : {}),
    },
  };
});
