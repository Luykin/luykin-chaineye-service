import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";

function createAdminWebVersionPlugin(buildId: string): Plugin {
  return {
    name: "admin-web-version-manifest",
    apply: "build",
    async writeBundle(outputOptions) {
      if (!outputOptions.dir) return;
      await fs.writeFile(
        path.join(outputOptions.dir, "version.json"),
        `${JSON.stringify({ buildId })}\n`,
        "utf8",
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = env.VITE_API_BASE_URL || "";
  const devDomain = env.VITE_DEV_DOMAIN || "";
  const port = Number(env.VITE_PORT || 5174);
  const buildId = process.env.ADMIN_WEB_BUILD_ID || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[vite-config] mode=${mode} apiBaseUrl=${apiBaseUrl}`);

  return {
    base: mode === "production" ? "/static/admin-web/" : "/",
    publicDir: mode === "production" ? false : "public",
    plugins: [react(), createAdminWebVersionPlugin(buildId)],
    define: {
      "import.meta.env.VITE_ADMIN_WEB_BUILD_ID": JSON.stringify(buildId),
    },
    esbuild: {
      // Avoid emitting template literals that contain raw newlines in the production bundle.
      // They are valid modern JS, but can be broken by some edge/minify layers and cause
      // browser-side "Invalid or unexpected token" before React mounts.
      supported: {
        "template-literal": false,
      },
    },
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
