import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works at the root or under any
  // folder (/admin/ by convention) of a static host.
  base: "./",
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "dist/admin",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // Pure-logic tests run in Node. UI tests opt in per file with
    // `// @vitest-environment happy-dom`.
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "agent/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
