import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CliError, printResult } from "../output";
import { dryRun } from "../ops/dryRun";
import { withSession } from "../ops/session";
import type { Command, CommandContext } from "./types";
import { AS_OPTION, boolOpt, positional, SITE_OPTION, strOpt, table, usage, YES_OPTION } from "./util";

// `agentcrm ext …` — create, test and ship AgentCRM extensions (modules and
// themes), and manage the ones installed on a CRM. Local actions (new,
// check, pack) need no site; install / list / enable / disable / uninstall /
// export act on one. Installing = running third-party code with the rights
// of every admin who opens the CRM: always a plan first, --yes to apply.

const TRUST_NOTE = "Installing runs this extension's code in the admin (and in CLI / MCP sessions) with the rights of the user who opens it — admins included. Only install code from an author you trust.";

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

async function scaffold({ io, options, positionals }: CommandContext) {
  const [, kind, id] = positionals;
  if (kind !== "module" && kind !== "theme") usage("ext new needs module or theme, then an id.", "e.g. agentcrm ext new module my-module");
  if (!id) usage(`ext new ${kind} needs an id (lowercase, dashes), e.g. ext new ${kind} my-${kind}.`);
  const dir = resolve(strOpt(options, "dir") ?? id);
  if (existsSync(dir) && readdirSync(dir).length > 0 && !boolOpt(options, "force")) {
    throw new CliError("dir-not-empty", `${dir} already exists and is not empty.`, "Pick another --dir (or --force to write into it).", 2);
  }
  const { scaffoldExtension } = await import("../ops/extScaffold");
  const res = scaffoldExtension({ kind, id, dir, name: strOpt(options, "name"), description: strOpt(options, "description"), author: strOpt(options, "author") });
  printResult(io, res, () => [`Created ${kind} "${id}" in ${dir}:`, ...res.files.map((f) => `  ${f}`), "", "Next:", ...res.next.map((n) => `  ${n}`)].join("\n"));
}

async function check({ io, options, positionals }: CommandContext) {
  const target = positionals[1] ?? ".";
  const kind = strOpt(options, "kind");
  if (kind && kind !== "module" && kind !== "theme") usage("--kind is module or theme.");
  const { readRawPackage } = await import("../ops/extPackage");
  const { checkExtension } = await import("../ops/extCheck");
  const raw = await readRawPackage(target);
  const report = await checkExtension(raw, { kind: kind as "module" | "theme" | undefined, callTools: !boolOpt(options, "no-call") });
  printResult(io, report, () => {
    const lines = [
      `${report.valid ? "PASS" : "FAIL"}  ${report.kind ?? "?"} ${report.id ?? "?"} ${report.version ?? ""} (apiVersion ${report.apiVersion ?? "?"}, admin API ${report.hostApi.min} – ${report.hostApi.version}) — bundle ${kb(report.size.bundle)}${report.size.style ? `, style ${kb(report.size.style)}` : ""}`,
      ...report.errors.map((e) => `  error  [${e.code}] ${e.message}${e.hint ? `\n         → ${e.hint}` : ""}`),
      ...report.warnings.map((w) => `  warn   [${w.code}] ${w.message}${w.hint ? `\n         → ${w.hint}` : ""}`),
    ];
    const r = report.registered;
    if (r) {
      if (r.routes.length) lines.push(`  routes: ${r.routes.join(", ")}`);
      if (r.navItems.length) lines.push(`  navigation: ${r.navItems.map((n) => `${n.id} → ${n.to}`).join(", ")}`);
      for (const [slot, ids] of Object.entries(r.slots)) lines.push(`  slot ${slot}: ${ids.join(", ")}`);
      if (r.settingsPage) lines.push("  settings page: Settings → Modules → " + report.name);
      if (r.aiTools.length) lines.push(`  AI tools: ${r.aiTools.map((t) => `${t.name}${t.mutating ? " (writes)" : ""}`).join(", ")}`);
      if (r.automationActions.length) lines.push(`  automation actions: ${r.automationActions.map((a) => a.id).join(", ")}`);
      if (r.hooks.actions.length || r.hooks.filters.length) lines.push(`  hooks: ${[...r.hooks.actions, ...r.hooks.filters].join(", ")}`);
      for (const c of report.toolCalls ?? []) lines.push(`  call ${c.name}({}): ${c.ok ? "ok" : `failed — ${c.error}`}`);
    }
    if (report.theme) lines.push(`  theme "${report.theme.name}": ${Object.entries(report.theme.appearance).map(([k, v]) => `${k}=${String(v)}`).join(", ")}${report.theme.css ? ` + ${kb(report.theme.css)} CSS` : ""}`);
    return lines.join("\n");
  });
  return report.valid ? 0 : 1;
}

async function pack({ io, options, positionals }: CommandContext) {
  const target = positionals[1] ?? ".";
  const { readPackage } = await import("../ops/extPackage");
  const { raw, pkg } = await readPackage(target);
  if (raw.sourceType === "zip") usage("ext pack takes a project or an unpacked folder, not a .zip.");
  const { packExtension } = await import("../../src/extensions/package");
  const bytes = await packExtension(pkg);
  const out = resolve(strOpt(options, "out") ?? join(raw.source, `${pkg.manifest.id}-${pkg.manifest.version}.zip`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const files = ["manifest.json", ...Object.keys(pkg.files)];
  printResult(io, { zip: out, bytes: bytes.length, id: pkg.manifest.id, kind: pkg.manifest.kind, version: pkg.manifest.version, files }, () => `Packed ${basename(out)} (${files.join(", ")}, ${kb(bytes.length)})`);
}

async function install({ io, options, positionals }: CommandContext) {
  const target = positional(positionals, 1, "ZIP or folder", "ext install <zip|dir> [--site <alias>] [--yes]");
  const { readPackage } = await import("../ops/extPackage");
  const { pkg, raw } = await readPackage(target);
  const apply = options.yes === true;
  const disabled = boolOpt(options, "disabled");
  return withSession(io, options, { lock: apply }, async (s) => {
    const ext = await import("../../src/ops/extensions");
    const existing = s.store.get("extensions", pkg.manifest.id) as { manifest?: { version: string }; enabled?: boolean; kind?: string } | undefined;
    const m = pkg.manifest;
    const plan = {
      id: m.id,
      kind: m.kind,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      description: m.description,
      author: m.author ?? null,
      homepage: m.homepage ?? null,
      dependsOn: m.dependsOn ?? [],
      mode: existing ? ("upgrade" as const) : ("install" as const),
      ...(existing?.manifest ? { from: existing.manifest.version, currentlyEnabled: !!existing.enabled } : {}),
      size: { bundle: new TextEncoder().encode(pkg.files["bundle.js"]).length, style: pkg.files["style.css"] ? new TextEncoder().encode(pkg.files["style.css"]).length : 0, ...(raw.zipBytes ? { zip: raw.zipBytes } : {}) },
      source: raw.source,
      warning: TRUST_NOTE,
    };
    if (!apply) {
      // Surfaces conflicts (kind change, permissions) before the user says yes.
      const { result } = await dryRun(s.ctx, (copy) => ext.installExtension(copy, pkg, disabled ? { enabled: false } : {}));
      return { needsConfirmation: true as const, plan: { ...plan, enabled: result.enabled, warnings: result.warnings } };
    }
    const result = await ext.installExtension(s.ctx, pkg, disabled ? { enabled: false } : {});
    // Load it in this process: proves the bundle runs and lists its tools.
    const report = await s.extensions.sync();
    const { getLoadedExtension } = await import("../../src/extensions/registry");
    const loaded = getLoadedExtension(m.id);
    const failure = report?.failed.find((f) => f.id === m.id || f.id === "*");
    if (failure && !loaded) return { ...result, author: m.author ?? null, load: { status: "error", error: failure.error } };
    return { ...result, author: m.author ?? null, load: loaded ? { status: loaded.status, ...(loaded.error ? { error: loaded.error } : {}) } : { status: result.enabled ? (s.extensions.safeMode ? "skipped" : "unknown") : "disabled" } };
  }, (r) =>
    r.needsConfirmation
      ? [
          `Would ${r.plan.mode} ${r.plan.kind} "${r.plan.name}" (${r.plan.id}) ${r.plan.mode === "upgrade" ? `${r.plan.from} → ` : ""}${r.plan.version}${r.plan.author ? ` by ${r.plan.author}` : ""}${r.plan.enabled ? "" : " (disabled)"}`,
          `  apiVersion ${r.plan.apiVersion}, bundle ${kb(r.plan.size.bundle)}${r.plan.dependsOn.length ? `, needs ${r.plan.dependsOn.join(", ")}` : ""}`,
          ...r.plan.warnings.map((w) => `  note: ${w}`),
          `  ${r.plan.warning}`,
          "Nothing changed — re-run with --yes once the user agrees.",
        ].join("\n")
      : `${r.mode === "upgrade" ? `Upgraded ${r.previousVersion} → ` : "Installed "}${r.id} ${r.version} (${r.enabled ? "enabled" : "disabled"}; load: ${r.load.status}${"error" in r.load ? ` — ${r.load.error}` : ""})${r.warnings.length ? `\n  ${r.warnings.join("\n  ")}` : ""}`);
}

export const extCommand: Command = {
  name: "ext",
  usage: "ext <new|check|pack|install|list|enable|disable|uninstall|export> …",
  summary:
    "Extensions (modules and themes loaded at runtime, no rebuild): new module|theme <id> scaffolds a project (Vite, typings, i18n en/fr), check <dir|zip> validates and loads the bundle like the admin and lists what it registers (exit 1 on errors), pack <dir> builds the ZIP, install <zip|dir> adds it to a CRM (plan first; installing runs code with admin rights), list, enable / disable, uninstall, export (download as ZIP).",
  subcommands: [
    { name: "new", usage: "ext new <module|theme> <id> [--dir <path>] [--name <name>] [--description <text>] [--author <name>] [--force]", summary: "Scaffold a standalone extension project (package.json, vite.config.ts, tsconfig + runtime typings, src/index.tsx, README).", writes: true },
    { name: "check", usage: "ext check [<dir|zip>] [--kind module|theme] [--no-call]", summary: "Validate manifest, ids, apiVersion, sizes, imports; load the bundle in a throw-away CRM and report routes, nav, slots, AI tools, automation actions, theme values." },
    { name: "pack", usage: "ext pack [<dir>] [--out <file.zip>]", summary: "ZIP manifest.json + bundle.js (+ style.css) for Settings → Modules → Install or `ext install`.", writes: true },
    { name: "install", usage: "ext install <zip|dir> [--site <alias>] [--disabled] [--yes]", summary: "Install or upgrade an extension on a CRM. Prints the plan (id, version, author, upgrade, size) unless --yes.", writes: true, destructive: true },
    { name: "list", usage: "ext list [--kind module|theme]", summary: "Installed extensions with version, enabled state and load status in this process." },
    { name: "enable", usage: "ext enable <id> [--cascade] [--yes]", summary: "Enable an installed extension (plan unless --yes).", writes: true },
    { name: "disable", usage: "ext disable <id> [--cascade] [--yes]", summary: "Disable it without uninstalling (plan unless --yes).", writes: true },
    { name: "uninstall", usage: "ext uninstall <id> [--force] [--yes]", summary: "Remove an extension (its module configuration is kept). Plan unless --yes.", writes: true, destructive: true },
    { name: "export", usage: "ext export <id> [--out <file.zip>]", summary: "Download an installed extension as its ZIP." },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "dir", type: "string", description: "new: target folder (default: ./<id>)." },
    { name: "name", type: "string", description: "new: display name." },
    { name: "description", type: "string", description: "new: one-sentence description." },
    { name: "author", type: "string", description: "new: author shown in the install plan and Settings → Modules." },
    { name: "force", type: "boolean", description: "new: write into a non-empty folder. uninstall: even if enabled modules depend on it." },
    { name: "kind", type: "string", description: "check: expected kind. list: only modules or themes." },
    { name: "no-call", type: "boolean", description: "check: don't smoke-call the AI tools on the demo data." },
    { name: "out", type: "string", description: "pack / export: ZIP path (default: <dir>/<id>-<version>.zip, ./<id>-<version>.zip)." },
    { name: "disabled", type: "boolean", description: "install: install it disabled." },
    { name: "cascade", type: "boolean", description: "enable / disable: also enable the dependencies / disable the dependents." },
  ],
  async run(ctx) {
    const { io, options, positionals } = ctx;
    const [action] = positionals;
    const apply = options.yes === true;
    switch (action) {
      case "new":
        return scaffold(ctx);
      case "check":
        return check(ctx);
      case "pack":
        return pack(ctx);
      case "install":
        return install(ctx);
      case "list": {
        const kind = strOpt(options, "kind");
        if (kind && kind !== "module" && kind !== "theme") usage("--kind is module or theme.");
        return withSession(io, options, {}, async (s) => {
          const { listExtensions } = await import("../../src/ops/extensions");
          const { getLoadedExtension } = await import("../../src/extensions/registry");
          return listExtensions(s.ctx, kind ? { kind: kind as "module" | "theme" } : {}).map((e) => ({ ...e, load: s.extensions.safeMode ? "skipped" : getLoadedExtension(e.id)?.status ?? (e.enabled ? "not loaded" : "disabled"), ...(getLoadedExtension(e.id)?.error ? { loadError: getLoadedExtension(e.id)?.error } : {}) }));
        }, (rows) => table(rows.map((r) => ({ ...r, enabled: r.enabled ? "yes" : "no" })), ["id", "kind", "name", "version", "enabled", "load", "author"]));
      }
      case "enable":
      case "disable": {
        const id = positional(positionals, 1, "extension id", `ext ${action} <id> [--yes]`);
        const enabled = action === "enable";
        const cascade = boolOpt(options, "cascade");
        return withSession(io, options, { lock: apply }, async (s) => {
          const ext = await import("../../src/ops/extensions");
          const before = ext.getExtension(s.ctx, id);
          if (!apply) {
            const { result } = await dryRun(s.ctx, async (copy) => {
              await ext.setExtensionEnabled(copy, id, enabled, { cascade });
              return (await import("../../src/ops/modules")).moduleStates(copy.store);
            });
            const now = new Map(result.map((m) => [m.id, m.enabled]));
            const changed = (await import("../../src/ops/modules")).moduleStates(s.store).filter((m) => now.has(m.id) && now.get(m.id) !== m.enabled).map((m) => ({ id: m.id, enabled: now.get(m.id)! }));
            if (before.kind === "theme" && before.enabled !== enabled) changed.push({ id, enabled });
            return { needsConfirmation: true as const, plan: { id, kind: before.kind, from: before.enabled, to: enabled, changed } };
          }
          const summary = await ext.setExtensionEnabled(s.ctx, id, enabled, { cascade });
          await s.extensions.sync();
          return summary;
        }, (r) => ("needsConfirmation" in r ? `Would ${action} ${id}${r.plan.changed.length > 1 ? ` (also: ${r.plan.changed.filter((c) => c.id !== id).map((c) => `${c.id} → ${c.enabled ? "on" : "off"}`).join(", ")})` : ""}.\nNothing changed — re-run with --yes once the user agrees.` : `${r.id} is now ${r.enabled ? "enabled" : "disabled"}.`));
      }
      case "uninstall": {
        const id = positional(positionals, 1, "extension id", "ext uninstall <id> [--yes]");
        const force = boolOpt(options, "force");
        return withSession(io, options, { lock: apply }, async (s) => {
          const ext = await import("../../src/ops/extensions");
          const summary = ext.getExtension(s.ctx, id);
          if (!apply) {
            await dryRun(s.ctx, (copy) => ext.uninstallExtension(copy, id, { force }));
            return { needsConfirmation: true as const, plan: { id, kind: summary.kind, name: summary.name, version: summary.version, enabled: summary.enabled, note: "The module configuration is kept; re-installing restores it." } };
          }
          const res = await ext.uninstallExtension(s.ctx, id, { force });
          await s.extensions.sync();
          return { ...res, name: summary.name, version: summary.version };
        }, (r) => (r.needsConfirmation ? `Would uninstall ${r.plan.kind} "${r.plan.name}" ${r.plan.version}.\nNothing changed — re-run with --yes once the user agrees.` : `Uninstalled ${r.id} ${r.version}.`));
      }
      case "export": {
        const id = positional(positionals, 1, "extension id", "ext export <id> [--out <file.zip>]");
        return withSession(io, options, {}, async (s) => {
          const { getExtensionPackage } = await import("../../src/ops/extensions");
          const { packExtension } = await import("../../src/extensions/package");
          const pkg = getExtensionPackage(s.ctx, id);
          const bytes = await packExtension(pkg);
          const out = resolve(strOpt(options, "out") ?? `${id}-${pkg.manifest.version}.zip`);
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, bytes);
          return { id, version: pkg.manifest.version, zip: out, bytes: bytes.length };
        }, (r) => `Wrote ${r.zip} (${kb(r.bytes)})`);
      }
      default:
        usage(action ? `Unknown ext action "${action}".` : "ext needs an action.", "Actions: new, check, pack, install, list, enable, disable, uninstall, export.");
    }
  },
};
