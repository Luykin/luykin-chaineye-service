var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var apiBaseUrl = env.VITE_API_BASE_URL || "";
    var devDomain = env.VITE_DEV_DOMAIN || "";
    var port = Number(env.VITE_PORT || 5174);
    console.log("[vite-config] mode=".concat(mode, " apiBaseUrl=").concat(apiBaseUrl));
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
                "@xhunt/auth-client": path.resolve(__dirname, "../packages/xhunt-auth-client/src/index.ts"),
                react: path.resolve(__dirname, "node_modules/react"),
                "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
                "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime.js"),
            },
        },
        server: __assign({ host: "127.0.0.1", port: port, strictPort: true }, (devDomain
            ? {
                allowedHosts: [devDomain],
                hmr: {
                    host: devDomain,
                    protocol: "wss",
                    clientPort: 443,
                },
            }
            : {})),
    };
});
