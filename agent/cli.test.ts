import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS } from "./commands";
import { parseFilters, parseScalar, parseSorts, fieldsInput } from "./commands/util";
import { FILTER_OPS } from "../src/core/types";
import { cli } from "./testing/cli";

// The JSON contract agents rely on: exactly one {ok,data} / {ok:false,
// error:{code,message,hint}} object on stdout, logs on stderr, exit 2 for
// usage errors, help --json listing every command with its arguments.

beforeAll(() => {
  process.env.AGENTCRM_HOME = mkdtempSync(join(tmpdir(), "agentcrm-cli-"));
});

const REQUIRED = [
  "help", "version", "status", "options", "credentials", "install", "site", "doctor", "serve", "deploy-admin",
  "records", "objects", "fields", "activities", "notes", "tasks", "pipelines", "views", "users", "settings",
  "import", "export", "report", "automations", "forms", "compact", "stats", "tools", "mcp",
];

describe("CLI contract", () => {
  it("help --json lists every command with usage, options and subcommands", async () => {
    const r = await cli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toHaveLength(1);
    const names = r.body.data.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(REQUIRED));
    const records = r.body.data.commands.find((c: { name: string }) => c.name === "records");
    expect(records.subcommands.map((s: { name: string }) => s.name)).toEqual(["list", "get", "create", "update", "delete", "restore", "search", "duplicates", "merge"]);
    expect(records.options.map((o: { name: string }) => o.name)).toEqual(expect.arrayContaining(["object", "filter", "sort", "limit", "fields", "set", "site", "yes"]));
    for (const c of r.body.data.commands) {
      expect(c.usage.startsWith(c.name)).toBe(true);
      expect(c.summary.length).toBeGreaterThan(10);
    }
    const one = await cli(["help", "records"]);
    expect(one.body.data.commands).toHaveLength(1);
    expect((await cli(["records", "--help"])).body.data.commands[0].name).toBe("records");
  });

  it("prints the version", async () => {
    const r = await cli(["version"]);
    expect(r.body).toMatchObject({ ok: true, data: { version: expect.stringMatching(/^\d+\.\d+\.\d+/), dataSchema: 1 } });
  });

  it("exits 2 with an error object on usage errors", async () => {
    const cases: [string[], string][] = [
      [["nope"], "unknown-command"],
      [["help", "--bogus"], "usage"],
      [["records", "frobnicate"], "usage"],
      [["records", "list"], "usage"],
      [["install"], "usage"],
      [["credentials", "set", "nope:x"], "invalid-account"],
      [["records", "list", "--object", "people", "--filter", "name:like:x"], "usage"],
    ];
    for (const [args, code] of cases) {
      const r = await cli(args);
      expect({ args, exit: r.code }).toEqual({ args, exit: 2 });
      expect(r.stdout).toHaveLength(1);
      expect(r.body).toMatchObject({ ok: false, error: { code, message: expect.any(String) } });
    }
  });

  it("fails with site-not-found + a hint when nothing is registered", async () => {
    const r = await cli(["records", "list", "--object", "people"]);
    expect(r.code).toBe(1);
    expect(r.body.error).toMatchObject({ code: "site-not-found", hint: expect.stringContaining("install") });
  });

  it("stores credentials without ever printing them", async () => {
    process.env.T_TOKEN = "ghp_supersecret";
    const set = await cli(["credentials", "set", "github:me", "--from-env", "T_TOKEN"]);
    expect(set.body.data).toEqual({ account: "github:me", type: "github", fields: ["token"] });
    const list = await cli(["credentials", "list"]);
    expect(JSON.stringify(list.body)).not.toContain("supersecret");
    expect((await cli(["credentials", "remove", "github:me"])).body.data.removed).toBe(true);
    expect((await cli(["credentials", "set", "s3:x", "--from-env", "ONLY_ONE"])).code).toBe(2);
  });

  it("documents the install plan in options", async () => {
    const r = await cli(["options"]);
    expect(r.body.data.backends.map((b: { id: string }) => b.id)).toEqual(["journal", "git-json", "firebase", "local"]);
    expect(r.body.data.locations.map((b: { id: string }) => b.id)).toEqual(["s3", "github", "gitlab", "local-folder"]);
    expect(r.body.data.planExample.data.backend).toBe("journal");
    expect(Object.keys(r.body.data.credentialTypes)).toEqual(["s3", "github", "gitlab", "firebase", "passphrase", "anthropic"]);
    const rules = await cli(["options", "--firebase-rules", "ada@acme.test"]);
    expect(rules.body.data.rules).toContain("ada@acme.test");
  });

  it("every subcommand usage starts with its command", () => {
    for (const c of COMMANDS) for (const s of c.subcommands ?? []) expect(s.usage.startsWith(`${c.name} `) || s.usage === `${c.name} ${s.name}`).toBe(true);
  });
});

describe("option parsing", () => {
  it("parses filters, sorts and --set values", () => {
    expect(parseFilters(["stage:eq:proposal", "amount:gte:1000", "email:notEmpty", "tags:in:vip,partner", "url:contains:https://x.io"], FILTER_OPS)).toEqual([
      { field: "stage", op: "eq", value: "proposal" },
      { field: "amount", op: "gte", value: 1000 },
      { field: "email", op: "notEmpty" },
      { field: "tags", op: "in", value: ["vip", "partner"] },
      { field: "url", op: "contains", value: "https://x.io" },
    ]);
    expect(parseSorts(["amount:desc", "-closeDate,name"])).toEqual([
      { field: "amount", dir: "desc" },
      { field: "closeDate", dir: "desc" },
      { field: "name", dir: "asc" },
    ]);
    expect(parseScalar("00123")).toBe("00123");
    expect(parseScalar("+33612")).toBe("+33612");
    expect(parseScalar("42")).toBe(42);
    expect(parseScalar("null")).toBeNull();
    expect(parseScalar('["a"]')).toEqual(["a"]);
    expect(parseScalar("2024-01-01")).toBe("2024-01-01");
    expect(fieldsInput({ fields: '{"a":1}', set: ["b=x=y", "a=2"] })).toEqual({ a: 2, b: "x=y" });
  });
});
