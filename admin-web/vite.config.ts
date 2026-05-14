import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "http://localhost:8090";

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
        "/api": {
          target,
          changeOrigin: true,
        },
        "/admin": {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
