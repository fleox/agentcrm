import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { installBrowserEnv } from "./browserEnv";
import { cli, fakeDist, siteCli, writePlan } from "./testing/cli";

// Customisation from the CLI, end to end on an encrypted journal in a
// local folder: modules (dependency conflict, cascade), appearance (set,
// preset, logo, CSS, reset), and the whole extension author flow —
// `ext new` → vite build (the project's own config) → `ext check` →
// `ext pack` → `ext install` → its AI tool in `tools list` / `tools call`
// → disable → uninstall.

const repo = resolve(__dirname, "..");
const root = mkdtempSync(join(tmpdir(), "agentcrm-e2e-customize-"));

beforeAll(() => {
  installBrowserEnv();
  process.env.AGENTCRM_HOME = join(root, "home");
  process.env.AGENTCRM_DIST = fakeDist(root);
  process.env.AGENTCRM_KDF_ITERATIONS = "1000";
});

afterAll(() => {
  delete process.env.AGENTCRM_DIST;
});

// A scaffolded project built like its author would (`npm run build`), with
// this repo's node_modules standing in for `npm install`.
async function buildProject(dir: string): Promise<void> {
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "dir");
  await build({ root: dir, configFile: join(dir, "vite.config.ts"), mode: "production", logLevel: "silent" });
}

async function packOf(dir: string, name: string, manifest: Record<string, unknown>, bundle: string): Promise<string> {
  const { packExtension } = await import("../src/extensions/package");
  const file = join(dir, `${name}.zip`);
  writeFileSync(file, await packExtension({ manifest: manifest as never, files: { "bundle.js": bundle } }));
  return file;
}

describe("customisation from the CLI", () => {
  it("installs a demo CRM", async () => {
    const plan = writePlan(root, "c", {
      alias: "c",
      owner: { name: "Owner", email: "owner@example.com" },
      data: { backend: "journal", location: { type: "local-folder", settings: { path: join(root, "data") } } },
      hosting: false,
      demo: true,
    });
    expect((await cli(["install", "--plan", plan])).code).toBe(0);
  }, 60_000);

  it("modules: list, disable with a dependency conflict, cascade, enable, config", async () => {
    const crm = siteCli("c");
    const list = await crm.ok(["modules", "list"]);
    expect(list.find((m: { id: string }) => m.id === "records")).toMatchObject({ required: true, enabled: true });
    expect((await crm.run(["modules", "disable", "records", "--yes"])).body.error?.code).toBe("invalid");

    // Plan, then apply.
    const plan = await crm.ok(["modules", "disable", "automations"]);
    expect(plan).toMatchObject({ needsConfirmation: true, plan: { changed: [{ id: "automations", enabled: false }] } });
    expect((await crm.ok(["modules", "get", "automations"])).enabled).toBe(true);
    await crm.ok(["modules", "disable", "automations", "--yes"]);
    expect((await crm.ok(["modules", "get", "automations"])).enabled).toBe(false);
    await crm.ok(["modules", "enable", "automations", "--yes"]);

    // An extension module that depends on deals → disabling deals conflicts.
    const zip = await packOf(root, "deal-notes", { id: "deal-notes", kind: "module", name: "Deal notes", version: "1.0.0", apiVersion: "1.0.0", description: "Depends on deals.", entry: "bundle.js", dependsOn: ["deals"] }, 'export default { id: "deal-notes", apiVersion: "1.0.0" };\n');
    expect((await crm.ok(["ext", "install", zip])).plan).toMatchObject({ id: "deal-notes", mode: "install", dependsOn: ["deals"] });
    expect((await crm.ok(["ext", "install", zip, "--yes"])).load.status).toBe("loaded");
    const conflict = await crm.run(["modules", "disable", "deals"]);
    expect(conflict.body.error?.code).toBe("conflict");
    // The hint names the blocker and the way out (not the generic "already exists").
    expect(conflict.body.error?.hint).toMatch(/Blocked by: deal-notes\. Re-run with --cascade/);
    const cascade = await crm.ok(["modules", "disable", "deals", "--cascade"]);
    expect(cascade.plan.changed).toEqual(expect.arrayContaining([{ id: "deals", enabled: false }, { id: "deal-notes", enabled: false }]));
    await crm.ok(["modules", "disable", "deals", "--cascade", "--yes"]);
    expect((await crm.ok(["ext", "list"])).find((e: { id: string }) => e.id === "deal-notes")).toMatchObject({ enabled: false, load: "disabled" });
    // Enabling the dependent with --cascade turns deals back on.
    expect((await crm.ok(["ext", "enable", "deal-notes", "--cascade"])).plan.changed).toEqual(expect.arrayContaining([{ id: "deals", enabled: true }]));
    await crm.ok(["ext", "enable", "deal-notes", "--cascade", "--yes"]);
    expect((await crm.ok(["modules", "get", "deals"])).enabled).toBe(true);
    await crm.ok(["ext", "uninstall", "deal-notes", "--yes"]);

    // Module configuration (plan, then apply).
    expect((await crm.ok(["modules", "config", "set", "dashboard", "--value", '{"layout":"compact"}'])).plan).toMatchObject({ before: null, after: { layout: "compact" } });
    await crm.ok(["modules", "config", "set", "dashboard", "--value", '{"layout":"compact"}', "--yes"]);
    expect((await crm.ok(["modules", "config", "get", "dashboard"])).config).toEqual({ layout: "compact" });
    expect((await crm.run(["modules", "config", "set", "dashboard", "--value", '{"token":"x"}', "--yes"])).code).not.toBe(0);
  }, 120_000);

  it("appearance: set, preset, logo, css, reset", async () => {
    const crm = siteCli("c");
    expect((await crm.ok(["appearance", "get"])).appearance).toMatchObject({ preset: "default", accent: "#3366ff" });
    const plan = await crm.ok(["appearance", "set", "--accent", "#FF5500", "--radius", "xl", "--mode", "dark"]);
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.plan.changes).toMatchObject({ accent: { from: "#3366ff", to: "#ff5500" }, radius: { to: "xl" }, defaultMode: { to: "dark" }, preset: { to: "custom" } });
    expect((await crm.ok(["appearance", "get"])).appearance.accent).toBe("#3366ff");
    expect((await crm.run(["appearance", "set", "--neutral", "purple", "--yes"])).body.error?.code).toBe("validation");
    await crm.ok(["appearance", "set", "--accent", "#FF5500", "--radius", "xl", "--mode", "dark", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance).toMatchObject({ accent: "#ff5500", radius: "xl", defaultMode: "dark", preset: "custom" });

    await crm.ok(["appearance", "preset", "ocean", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance).toMatchObject({ preset: "ocean", accent: "#0891b2", neutral: "slate", defaultMode: "dark" });
    expect((await crm.ok(["appearance", "presets"])).map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["default", "ocean", "high-contrast"]));
    expect((await crm.run(["appearance", "preset", "nope", "--yes"])).body.error?.code).toBe("notFound");

    const png = join(root, "logo.png");
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    await crm.ok(["appearance", "logo", png, "--yes"]);
    await crm.ok(["appearance", "favicon", png, "--yes"]);
    const css = join(root, "brand.css");
    writeFileSync(css, ".acrm-brand { color: rgb(var(--acc-600)); }\n");
    await crm.ok(["appearance", "css", css, "--yes"]);
    const got = (await crm.ok(["appearance", "get"])).appearance;
    expect(got.logo).toMatch(/^image\/png/);
    expect(got.customCss).toMatch(/bytes/);
    expect((await crm.ok(["appearance", "get", "--full"])).appearance.logo).toMatch(/^data:image\/png;base64,/);
    writeFileSync(join(root, "bad.css"), "<script>alert(1)</script>");
    expect((await crm.run(["appearance", "css", join(root, "bad.css"), "--yes"])).body.error?.code).toBe("validation");

    // A preset keeps the branding; reset keeps the logo unless --branding.
    await crm.ok(["appearance", "preset", "forest", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance.logo).toMatch(/^image\/png/);
    await crm.ok(["appearance", "reset", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance).toMatchObject({ preset: "default", accent: "#3366ff", customCss: null });
    expect((await crm.ok(["appearance", "get"])).appearance.logo).toMatch(/^image\/png/);
    await crm.ok(["appearance", "reset", "--branding", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance.logo).toBeNull();
  }, 120_000);

  it("ext: new module → build → check → pack → install → tools → disable → uninstall", async () => {
    const dir = join(root, "my-test");
    const created = (await cli(["ext", "new", "module", "my-test", "--dir", dir, "--author", "Tester"])).body.data;
    expect(created.files).toEqual(expect.arrayContaining(["package.json", "manifest.json", "vite.config.ts", "tsconfig.json", "src/index.tsx", "types/agentcrm-runtime.d.ts", "README.md"]));
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts).toMatchObject({ build: "vite build", check: expect.stringContaining("ext check ."), pack: expect.stringContaining("ext pack .") });
    expect((await cli(["ext", "new", "module", "my-test", "--dir", dir])).body.error?.code).toBe("dir-not-empty");
    expect((await cli(["ext", "new", "module", "deals", "--dir", join(root, "x")])).code).toBe(2);

    // Not built yet.
    const early = await cli(["ext", "check", dir]);
    expect(early.code).toBe(1);
    expect(early.body.data.errors[0].code).toBe("notBuilt");

    await buildProject(dir);
    expect(existsSync(join(dir, "dist", "bundle.js"))).toBe(true);
    const check = await cli(["ext", "check", dir]);
    expect(check.body.data.errors).toEqual([]);
    expect(check.code).toBe(0);
    expect(check.body.data).toMatchObject({ valid: true, loaded: true, id: "my-test", kind: "module", imports: expect.arrayContaining(["@agent-crm/runtime", "react/jsx-runtime"]) });
    expect(check.body.data.registered).toMatchObject({ routes: ["/my-test"], navItems: [{ id: "my-test", to: "/my-test" }], slots: { recordDetailTabs: ["my-test"] }, aiTools: [{ name: "my_test_summary", mutating: false }] });
    expect(check.body.data.toolCalls).toEqual([{ name: "my_test_summary", ok: true }]);

    const packed = (await cli(["ext", "pack", dir])).body.data;
    expect(packed).toMatchObject({ id: "my-test", version: "0.1.0", files: ["manifest.json", "bundle.js"] });
    expect((await cli(["ext", "check", packed.zip])).body.data.valid).toBe(true);

    const crm = siteCli("c");
    const plan = await crm.ok(["ext", "install", packed.zip]);
    expect(plan).toMatchObject({ needsConfirmation: true, plan: { id: "my-test", version: "0.1.0", author: "Tester", mode: "install", warning: expect.stringContaining("trust") } });
    expect((await crm.ok(["ext", "list"])).length).toBe(0);
    const installed = await crm.ok(["ext", "install", packed.zip, "--yes"]);
    expect(installed).toMatchObject({ id: "my-test", mode: "install", enabled: true, load: { status: "loaded" } });
    // Re-installing = upgrade plan.
    expect((await crm.ok(["ext", "install", dir])).plan).toMatchObject({ mode: "upgrade", from: "0.1.0" });

    const tools = (await crm.ok(["tools", "list"])).tools;
    expect(tools.find((t: { name: string }) => t.name === "my_test_summary")).toMatchObject({ source: "extension", mutating: false });
    const call = await crm.ok(["tools", "call", "my_test_summary", "--input", '{"object":"companies"}']);
    expect(call.result.counts.companies).toBeGreaterThan(0);
    expect((await crm.ok(["tools", "list", "--safe"])).tools.map((t: { name: string }) => t.name)).not.toContain("my_test_summary");
    expect((await crm.ok(["modules", "list"])).find((m: { id: string }) => m.id === "my-test")).toMatchObject({ source: "extension", enabled: true });

    const exported = await crm.ok(["ext", "export", "my-test", "--out", join(root, "exported.zip")]);
    expect((await cli(["ext", "check", exported.zip])).body.data.valid).toBe(true);

    expect((await crm.ok(["ext", "disable", "my-test"])).needsConfirmation).toBe(true);
    await crm.ok(["ext", "disable", "my-test", "--yes"]);
    expect((await crm.ok(["tools", "list"])).tools.map((t: { name: string }) => t.name)).not.toContain("my_test_summary");
    expect((await crm.ok(["ext", "uninstall", "my-test"])).needsConfirmation).toBe(true);
    await crm.ok(["ext", "uninstall", "my-test", "--yes"]);
    expect(await crm.ok(["ext", "list"])).toEqual([]);
  }, 180_000);

  it("ext: new theme → build → check → install → preset", async () => {
    const dir = join(root, "brand-theme");
    await cli(["ext", "new", "theme", "brand-theme", "--dir", dir]);
    await buildProject(dir);
    const check = (await cli(["ext", "check", dir])).body.data;
    expect(check).toMatchObject({ valid: true, kind: "theme", theme: { name: "Brand Theme", appearance: { accent: "#0f766e" } } });
    expect(check.theme.css).toBeGreaterThan(0);
    const crm = siteCli("c");
    await crm.ok(["ext", "install", dir, "--yes"]);
    expect((await crm.ok(["appearance", "presets"])).find((p: { id: string }) => p.id === "brand-theme")).toMatchObject({ source: "extension", enabled: true, loaded: true });
    await crm.ok(["appearance", "preset", "brand-theme", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance).toMatchObject({ themeId: "brand-theme", accent: "#0f766e", sidebar: "dark" });
    await crm.ok(["ext", "uninstall", "brand-theme", "--yes"]);
    expect((await crm.ok(["appearance", "get"])).appearance.themeId).toBeUndefined();
  }, 180_000);

  it("extensions in CLI sessions: register() hooks and automation actions run", async () => {
    const bundle = `import { ops } from "@agent-crm/runtime";
export default {
  id: "auto-ext",
  apiVersion: "1.0.0",
  register(api) {
    api.addAction("record.created", async (ctx, { record }) => {
      if (record.fields.name === "Hook Co") await ops.addNote(ctx, { object: record.object, id: record.id }, "Seen by the auto-ext hook.");
    });
  },
  automationActions: [{ id: "auto-ext.stamp", label: "Stamp", async run(ctx, { record }) { await ops.addNote(ctx, { object: record.object, id: record.id }, "Stamped by auto-ext."); return "stamped"; } }],
  aiTools: [{
    name: "auto_ext_setup",
    description: "Creates the scheduled automation of the auto-ext test extension.",
    inputSchema: { type: "object", properties: {} },
    mutating: true,
    handler: (ctx) => ops.createAutomation(ctx, { name: "Stamp Hook Co", enabled: true, object: "companies", trigger: { type: "schedule", everyHours: 1 }, conditions: [{ field: "name", op: "eq", value: "Hook Co" }], actions: [{ type: "extension", action: "auto-ext.stamp", params: {} }] }),
  }],
};
`;
    const zip = await packOf(root, "auto-ext", { id: "auto-ext", kind: "module", name: "Auto ext", version: "1.0.0", apiVersion: "1.0.0", description: "Hooks and automation actions.", entry: "bundle.js" }, bundle);
    const crm = siteCli("c");
    await crm.ok(["ext", "install", zip, "--yes"]);
    const company = await crm.ok(["records", "create", "--object", "companies", "--set", "name=Hook Co"]);
    const notes = async () => (await crm.ok(["activities", "list", "--record", company.id])) as unknown;
    expect(JSON.stringify(await notes())).toContain("Seen by the auto-ext hook.");
    // --safe: the hook doesn't run.
    const other = await crm.ok(["records", "create", "--object", "companies", "--set", "name=Hook Co", "--safe"]);
    expect(JSON.stringify(await crm.ok(["activities", "list", "--record", other.id]))).not.toContain("auto-ext hook");
    await crm.ok(["records", "delete", other.id, "--yes"]);
    await crm.ok(["tools", "call", "auto_ext_setup", "--input", "{}"]);
    const dry = await crm.ok(["automations", "run"]);
    expect(dry.needsConfirmation).toBe(true);
    const run = await crm.ok(["automations", "run", "--yes"]);
    expect(run).toMatchObject({ ran: 1, errors: 0 });
    expect(JSON.stringify(await notes())).toContain("Stamped by auto-ext.");
    await crm.ok(["ext", "uninstall", "auto-ext", "--yes"]);
  }, 120_000);

  it("ext check reports broken packages", async () => {
    const bad = await packOf(root, "bad", { id: "bad-imports", kind: "module", name: "Bad", version: "1.0.0", apiVersion: "1.0.0", description: "x", entry: "bundle.js" }, 'export default { id: "bad-imports", apiVersion: "1.0.0" };\n').catch(() => null);
    expect(bad).not.toBeNull();
    const folder = mkdtempSync(join(root, "raw-"));
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({ id: "Bad_Id", kind: "module", name: "X", version: "1", apiVersion: "9.0.0", entry: "bundle.js", extra: 1 }));
    writeFileSync(join(folder, "bundle.js"), 'import _ from "lodash";\nexport const x = 1;\n');
    const r = await cli(["ext", "check", folder]);
    expect(r.code).toBe(1);
    const codes = r.body.data.errors.map((e: { code: string }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["manifest", "imports", "noDefaultExport"]));
    // Mismatched id between manifest and bundle → load error.
    const mismatch = mkdtempSync(join(root, "raw-"));
    writeFileSync(join(mismatch, "manifest.json"), JSON.stringify({ id: "good-id", kind: "module", name: "X", version: "1.0.0", apiVersion: "1.0.0", description: "x", entry: "bundle.js" }));
    writeFileSync(join(mismatch, "bundle.js"), 'export default { id: "other-id", apiVersion: "1.0.0" };\n');
    const m = (await cli(["ext", "check", mismatch])).body.data;
    expect(m.errors.map((e: { code: string }) => e.code)).toEqual(["load"]);
  }, 60_000);

  it("ext install refuses a bundle that doesn't load (the installed version keeps running)", async () => {
    const crm = siteCli("c");
    const manifest = { id: "fragile-ext", kind: "module", name: "Fragile", version: "1.0.0", apiVersion: "1.0.0", description: "x", entry: "bundle.js" };
    const good = await packOf(root, "fragile-1", manifest, 'export default { id: "fragile-ext", apiVersion: "1.0.0" };\n');
    expect((await crm.ok(["ext", "install", good, "--yes"])).load.status).toBe("loaded");
    // Same version again: allowed, with a warning in the plan.
    expect((await crm.ok(["ext", "install", good])).plan.warnings).toEqual([expect.stringMatching(/already installed/)]);
    const broken = await packOf(root, "fragile-2", { ...manifest, version: "1.1.0" }, "export default {;\n");
    for (const args of [["ext", "install", broken], ["ext", "install", broken, "--yes"]]) {
      const r = await crm.run(args);
      expect(r.body.error).toMatchObject({ code: "invalid-package", message: expect.stringMatching(/doesn't pass the check/) });
    }
    const mismatch = await packOf(root, "fragile-3", { ...manifest, version: "1.2.0" }, 'export default { id: "other-ext", apiVersion: "1.0.0" };\n');
    expect((await crm.run(["ext", "install", mismatch, "--yes"])).body.error?.code).toBe("invalid-package");
    expect((await crm.ok(["ext", "list"])).find((e: { id: string }) => e.id === "fragile-ext")).toMatchObject({ version: "1.0.0", load: "loaded" });
    // --force skips the trial load.
    expect((await crm.ok(["ext", "install", mismatch, "--force", "--yes"])).load.status).toBe("error");
    // A downgrade is flagged.
    expect((await crm.ok(["ext", "install", good])).plan.warnings).toEqual(["Downgrade: 1.2.0 → 1.0.0."]);
    await crm.ok(["ext", "uninstall", "fragile-ext", "--yes"]);
  }, 120_000);

  it("CLI hints and flags: leading --safe, dependency conflicts, appearance errors, image changes", async () => {
    const crm = siteCli("c");
    // Global flags before the command.
    const safe = await cli(["--safe", "ext", "list", "--site", "c"]);
    expect(safe.code).toBe(0);
    // A dependency conflict hints at --cascade (not "already exists").
    const zip = await packOf(root, "dep-hint", { id: "dep-hint", kind: "module", name: "Dep hint", version: "1.0.0", apiVersion: "1.0.0", description: "x", entry: "bundle.js", dependsOn: ["deals"] }, 'export default { id: "dep-hint", apiVersion: "1.0.0" };\n');
    await crm.ok(["ext", "install", zip, "--yes"]);
    const conflict = (await crm.run(["modules", "disable", "deals", "--yes"])).body.error;
    expect(conflict).toMatchObject({ code: "conflict", hint: expect.stringMatching(/--cascade/) });
    await crm.ok(["ext", "uninstall", "dep-hint", "--yes"]);
    // Appearance validation errors hint at appearance, not at records.
    const bad = (await crm.run(["appearance", "set", "--accent", "#12345", "--yes"])).body.error;
    expect(bad).toMatchObject({ code: "validation", hint: expect.stringMatching(/appearance/) });
    expect(bad?.hint).not.toMatch(/objects get/);
    expect((await crm.run(["modules", "config", "set", "dashboard", "--value", '{"apiKey":"sk-1"}', "--yes"])).body.error).toMatchObject({ code: "validation", hint: expect.stringMatching(/no secrets/) });
    // Two logos of the same size are still a change; scripted SVGs are refused.
    const a = join(root, "a.svg");
    const b = join(root, "b.svg");
    writeFileSync(a, '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#111111"/></svg>');
    writeFileSync(b, '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#222222"/></svg>');
    await crm.ok(["appearance", "logo", a, "--yes"]);
    expect((await crm.ok(["appearance", "logo", b])).plan.changes).toHaveProperty("logo");
    const evil = join(root, "evil.svg");
    writeFileSync(evil, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await crm.run(["appearance", "logo", evil, "--yes"])).body.error?.code).toBe("validation");
    await crm.ok(["appearance", "reset", "--branding", "--yes"]);
  }, 120_000);
});
