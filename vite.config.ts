import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Custom logger to suppress all output
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  customLogger: silentLogger,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    open: false,
  },
  logLevel: 'silent',
}));
