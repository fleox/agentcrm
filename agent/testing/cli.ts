import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../cli";
import type { Io } from "../output";

// Shared helpers of the e2e tests: run the CLI in-process with --json,
// write plans, build a fake admin dist.

export interface CliRun {
  code: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string; message: string; hint?: string } };
  stdout: string[];
  stderr: string[];
}

export async function cli(args: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = { json: true, out: (t) => void stdout.push(t), err: (t) => void stderr.push(t) };
  const code = await main([...args, "--json"], io);
  return { code, body: JSON.parse(stdout.at(-1) ?? "{}"), stdout, stderr };
}

// `cli` bound to one site; throws with the CLI error when a step that
// should succeed doesn't.
export function siteCli(alias: string) {
  const run = (args: string[]) => cli([...args, "--site", alias]);
  const ok = async (args: string[]) => {
    const r = await run(args);
    if (r.code !== 0 || !r.body.ok) throw new Error(`agentcrm ${args.join(" ")} → ${r.code}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    return r.body.data;
  };
  return { run, ok };
}

export function writePlan(dir: string, name: string, plan: unknown): string {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(plan));
  return file;
}

// A minimal admin build: what install / deploy-admin upload.
export function fakeDist(dir: string, version = "0.1.0"): string {
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "admin", "assets"), { recursive: true });
  writeFileSync(join(dist, "admin", "index.html"), '<!doctype html><script src="./config.js"></script><script type="module" src="./assets/index-abc.js"></script>');
  writeFileSync(join(dist, "admin", "assets", "index-abc.js"), "console.log('admin')");
  writeFileSync(join(dist, "admin", "config.js"), "window.__AGENTCRM_CONFIG__ = null;\n");
  writeFileSync(join(dist, "version.json"), JSON.stringify({ name: "@agent-crm/agentcrm", version, minSkillsVersion: "0.1.0", dataSchema: 1 }));
  return dist;
}
