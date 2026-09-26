import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Story 7.5: web/'s Vite build config. Dev proxies /api to the local server
// (shell/server.ts, LOOPBACK_HOST:DEFAULT_PORT); the production bundle is
// built to dist/ and served by shell/server.ts itself, so no proxy is needed
// there.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
