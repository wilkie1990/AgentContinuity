import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.AGENT_CONTINUITY_URL ?? "http://127.0.0.1:4732";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4733,
    // In development the UI runs on its own port and proxies the local API.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/health": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
