import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { buildConfigJsSource, type RuntimeConfig } from "../../src/lib/runtimeConfig";
import { createGitPagesConnector, type GitPagesSettings } from "../../src/shared/storage/connectors/gitPages";
import { createS3Connector, type S3Settings } from "../../src/shared/storage/connectors/s3";
import type { BatchOp, StorageConnector } from "../../src/shared/storage/types";
import { CliError } from "../output";
import { distRoot, readVersionInfo } from "../paths";
import { createFsConnector } from "./fsConnector";
import type { Target } from "./plan";

// Builds storage connectors from Node (data locations and admin hostings)
// and writes the admin build onto a hosting. Built from the factories
// directly, never through the registry: one process may handle several
// sites (MCP, tests).

export function buildConnector(target: Target): StorageConnector {
  switch (target.connectorId) {
    case "s3":
      return createS3Connector(target.settings as unknown as S3Settings);
    case "git-pages":
      return createGitPagesConnector({ token: "", ...target.settings } as unknown as GitPagesSettings);
    case "local-folder":
      return createFsConnector({ path: target.settings.path });
    default:
      throw new CliError("unsupported-storage", `The "${target.connectorId}" storage can't be used from the CLI.`, "Use an S3 bucket, a GitHub / GitLab repo or a local folder.");
  }
}

export function adminDir(): string {
  return join(distRoot(), "admin");
}

// Files of the admin build (config.js excluded: it is generated per site).
export function adminFiles(): string[] {
  const root = adminDir();
  if (!existsSync(join(root, "index.html"))) {
    throw new CliError("admin-missing", `No admin build at ${root}.`, "Use the npm package (`npx -y @agent-crm/agentcrm …`), or run `npm run build` in a clone.");
  }
  // Agent-written manifest (scripts/write-admin-manifest.mjs) when present.
  const manifest = join(root, "admin-files.json");
  if (existsSync(manifest)) {
    try {
      const files = (JSON.parse(readFileSync(manifest, "utf8")) as { files?: unknown }).files;
      if (Array.isArray(files) && files.every((f) => typeof f === "string")) {
        return [...new Set([...(files as string[]).filter((f) => f !== "config.js" && f !== "version.json" && existsSync(join(root, f))), "admin-files.json"])];
      }
    } catch {
      /* walk instead */
    }
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const abs = join(dir, name);
      return statSync(abs).isDirectory() ? walk(abs) : [abs];
    });
  return walk(root)
    .map((abs) => relative(root, abs).split(sep).join("/"))
    .filter((f) => f !== "config.js" && f !== "version.json" && !f.endsWith(".DS_Store"))
    .sort();
}

const putBytes = (path: string, bytes: Uint8Array): BatchOp => ({ type: "put", path, content: Buffer.from(bytes).toString("base64"), encoding: "base64" });

// The admin's files + version.json + a config.js for this site, under
// `<folder>/`. index.html last, for hosts that apply ops one by one.
export function adminOps(folder: string, runtime: RuntimeConfig): { ops: BatchOp[]; version: string } {
  const root = adminDir();
  const files = adminFiles();
  const ordered = [...files.filter((f) => f !== "index.html"), "index.html"];
  const info = readVersionInfo();
  const prefix = folder ? `${folder.replace(/^\/+|\/+$/g, "")}/` : "";
  const ops: BatchOp[] = ordered.map((f) => putBytes(`${prefix}${f}`, readFileSync(join(root, f))));
  ops.splice(ops.length - 1, 0, { type: "put", path: `${prefix}version.json`, content: JSON.stringify(info, null, 2) + "\n" });
  ops.splice(ops.length - 1, 0, { type: "put", path: `${prefix}config.js`, content: buildConfigJsSource(runtime) });
  return { ops, version: info.version };
}

export async function applyOps(connector: StorageConnector, ops: BatchOp[]): Promise<void> {
  if (connector.commitBatch) {
    await connector.commitBatch(ops);
    return;
  }
  for (const op of ops) {
    if (op.type === "put") await connector.put(op);
    else if (op.type === "delete") await connector.delete(op.path);
    else if (connector.deletePrefix) await connector.deletePrefix(op.path);
  }
}
