// Extension API versioning + the runtime specifiers external bundles
// import. Pure (shared by the admin, the loader, the CLI).
//
// Bump EXTENSION_API_VERSION (minor) whenever the runtime API object
// (src/extensions/runtime.ts) gains an export; raise
// EXTENSION_MIN_API_VERSION only on a breaking change.

export const EXTENSION_API_VERSION = "1.0.0";
export const EXTENSION_MIN_API_VERSION = "1.0.0";

// Global the admin populates (src/extensions/runtime.ts) and the stubs in
// public/runtime/*.js read.
export const RUNTIME_GLOBAL = "__AGENTCRM_RUNTIME__";

// Bare specifiers provided by the admin (import map in index.html →
// public/runtime/<file>). Bundles must externalise exactly these.
export const RUNTIME_MODULES = {
  react: "react.js",
  "react/jsx-runtime": "react-jsx-runtime.js",
  "react-dom": "react-dom.js",
  "react-dom/client": "react-dom-client.js",
  "react-i18next": "react-i18next.js",
  "lucide-react": "lucide-react.js",
  "@agent-crm/runtime": "agentcrm-runtime.js",
} as const;

export type RuntimeSpecifier = keyof typeof RUNTIME_MODULES;
export const RUNTIME_SPECIFIERS = Object.keys(RUNTIME_MODULES) as RuntimeSpecifier[];
// Folder of the stubs, relative to the admin's index.html.
export const RUNTIME_DIR = "runtime";

// Package limits (bytes).
export const EXTENSION_LIMITS = {
  bundle: 1.5 * 1024 * 1024,
  style: 256 * 1024,
  manifest: 16 * 1024,
  zip: 4 * 1024 * 1024,
} as const;

// Compares "1.2.3"-like versions (pre-release suffixes ignored).
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) =>
    String(s)
      .split("-")[0]
      .split(".")
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

export function isCompatibleApiVersion(version: unknown): boolean {
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) && compareVersions(version, EXTENSION_MIN_API_VERSION) >= 0 && compareVersions(version, EXTENSION_API_VERSION) <= 0;
}
