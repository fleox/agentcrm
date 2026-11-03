import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakeDist, writePlan } from "./testing/cli";

// The published package ships dist/agent only (no node_modules): the
// bundle must run with Node alone. Runs when dist/agent was built
// (`npm run build`, CI runs the tests again after the build).

const BUNDLE = resolve(__dirname, "..", "dist", "agent", "agentcrm.mjs");
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const has = existsSync(BUNDLE);

function run(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [BUNDLE, ...args, "--json"], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, body: JSON.parse(r.stdout.trim().split("\n").at(-1) || "{}"), stderr: r.stderr };
}

describe.skipIf(!has)("dist/agent bundle", () => {
  it("requires no package outside the bundle", () => {
    const dir = join(BUNDLE, "..");
    const files = [BUNDLE, ...readdirSync(join(dir, "chunks")).map((f) => join(dir, "chunks", f))];
    const offenders: string[] = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const m of code.matchAll(/\brequire\d*\(\s*"([^"./][^"]*)"\s*\)|^import\s[^;]*?from\s+"([^"./][^"]*)";?$|\bimport\(\s*"([^"./][^"]*)"\s*\)/gm)) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (!BUILTINS.has(spec) && !BUILTINS.has(spec.split("/")[0])) offenders.push(`${file.slice(dir.length + 1)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("answers help --json and runs a local CRM + an MCP session", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentcrm-bundle-"));
    const env = { AGENTCRM_HOME: join(root, "home"), AGENTCRM_DIST: fakeDist(root), AGENTCRM_KDF_ITERATIONS: "1000" };
    const help = run(["help"], env);
    expect(help.code).toBe(0);
    expect(help.body.data.commands.length).toBeGreaterThan(25);
    expect(run(["nope"], env).code).toBe(2);

    const plan = writePlan(root, "p", { alias: "b", owner: { name: "O", email: "o@example.com" }, data: { backend: "journal", location: { type: "local-folder", settings: { path: join(root, "data") } } }, hosting: false });
    const install = run(["install", "--plan", plan], env);
    expect(install.body).toMatchObject({ ok: true, data: { installed: true } });
    expect(run(["records", "create", "--object", "companies", "--set", "name=Bundled Inc"], env).body.data.label).toBe("Bundled Inc");

    // MCP over the real stdio of a spawned process.
    const child = spawn(process.execPath, [BUNDLE, "mcp", "--site", "b"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const lines: string[] = [];
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
    const waitFor = async (id: number) => {
      for (let t = 0; t < 400; t++) {
        const hit = lines.map((l) => JSON.parse(l)).find((r) => r.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`no MCP answer for ${id}`);
    };
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect((await waitFor(1)).result.serverInfo.name).toBe("agentcrm");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((await waitFor(2)).result.tools.length).toBeGreaterThan(10);
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_records", arguments: { query: "Bundled" } } });
    const call = await waitFor(3);
    expect(call.result.isError).toBe(false);
    expect(call.result.content[0].text).toContain("Bundled Inc");
    child.stdin.end();
    const code = await new Promise((r) => child.on("exit", r));
    expect(code).toBe(0);
  }, 60_000);
});
