import { defineConfig } from "vite";

// Builds the `agentcrm` CLI (agent/bin.ts) into ONE self-contained Node
// entry, dist/agent/agentcrm.mjs (+ lazy chunks) — every dependency is
// inlined so the npm package needs no runtime dependencies (mirror of
// cms-ia's vite.agent.config.ts).
const CJS_SHIM = [
  'import { createRequire as __acrmRequire } from "node:module";',
  'import { fileURLToPath as __acrmPath } from "node:url";',
  'import { dirname as __acrmDirname } from "node:path";',
  "const require = __acrmRequire(import.meta.url);",
  "const __filename = __acrmPath(import.meta.url);",
  "const __dirname = __acrmDirname(__filename);",
].join("\n");

export default defineConfig({
  // public/ belongs to the admin build — keep it out of dist/agent/.
  publicDir: false,
  define: {
    __AGENTCRM_BUNDLED__: "true",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: "agent/bin.ts",
    target: "node20",
    outDir: "dist/agent",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "agentcrm.mjs",
        // Commands load the engine's modules on demand, so `help` /
        // `version` start instantly.
        chunkFileNames: "chunks/[name]-[hash].mjs",
        banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node\n" : "") + CJS_SHIM,
      },
    },
  },
});
