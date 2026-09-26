import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // listen on 0.0.0.0 so the dev server is reachable from other devices
    // (phone) on the same network via http://<LAN-IP>:<port>
    host: true,
    allowedHosts: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    server: {
      deps: {
        inline: [
          // ships .mjs importing extensionless "lodash/isEqual" — native Node
          // ESM resolution cannot load it, so let Vite resolve it
          "@refinedev/react-table",
          // @refinedev/react-router ships TSX (Vitest force-inlines it); its
          // react-router then loads as .mjs while bare imports could go native
          // (CJS index.js) — two instances split the Router context.
          /(^|[\\/])react-router(?=[@\\/]|$)/,
        ],
      },
    },
  },
});
