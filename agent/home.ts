import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// ~/.agentcrm (or $AGENTCRM_HOME): the CLI's own state, shared by every
// agent session on this computer (mirror of cms-ia agent/home.ts).
//   sites.json        registered CRMs — never secrets
//   credentials.json  access tokens / keys per account, mode 0600
//   locks/<alias>     one running write operation per site

export function homeDir(): string {
  return resolve(process.env.AGENTCRM_HOME || join(homedir(), ".agentcrm"));
}

export function homePath(...parts: string[]): string {
  return join(homeDir(), ...parts);
}

export function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

// Atomic write (temp file + rename) so a crash never leaves half a file.
export function writeJsonFile(file: string, value: unknown, mode = 0o644): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, file);
}

// True when group / others can read the file (credentials must be 0600).
export function isWorldReadable(file: string): boolean {
  if (process.platform === "win32" || !existsSync(file)) return false;
  return (statSync(file).mode & 0o077) !== 0;
}
