// Shared Vite config of the example extensions (each example's
// vite.config.ts calls it). What matters:
//
//   1. Library mode, ONE ESM file `bundle.js` default-exporting
//      defineModule({...}) / defineTheme({...}).
//   2. The runtime specifiers are external — at runtime the admin maps them
//      to its own instances (import map + public/runtime/*.js stubs): one
//      React, one router, one store. Never bundle react / react-dom.
//   3. inlineDynamicImports: the admin only loads bundle.js, chunks 404.
//   4. Production JSX (no jsxDEV: the admin doesn't map react/jsx-dev-runtime).

import { defineConfig, type UserConfig } from "vite";

export const RUNTIME_EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "react-i18next", "lucide-react", "@agent-crm/runtime"];

export function extensionConfig(entry: string): UserConfig {
  return defineConfig({
    esbuild: { jsx: "automatic", jsxDev: false },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "warn",
    build: {
      lib: { entry, formats: ["es"], fileName: () => "bundle.js" },
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      minify: true,
      rollupOptions: { external: RUNTIME_EXTERNALS, output: { inlineDynamicImports: true } },
    },
  });
}
