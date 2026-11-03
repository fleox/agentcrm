// Test helpers for the extension system (not imported by production code).

import type { ExtensionPackage } from "./types";

// A minimal valid package (module by default).
export function fakePackage(id: string, opts: { kind?: "module" | "theme"; version?: string; dependsOn?: string[]; code?: string; apiVersion?: string } = {}): ExtensionPackage {
  return {
    manifest: {
      id,
      kind: opts.kind ?? "module",
      name: id
        .split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" "),
      version: opts.version ?? "1.0.0",
      apiVersion: opts.apiVersion ?? "1.0.0",
      description: `The ${id} extension.`,
      entry: "bundle.js",
      ...(opts.dependsOn ? { dependsOn: opts.dependsOn } : {}),
    },
    files: { "bundle.js": opts.code ?? `export default { id: ${JSON.stringify(id)}, apiVersion: "1.0.0" };\n` },
  };
}
