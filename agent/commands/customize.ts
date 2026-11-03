import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { Appearance, AppearancePatch } from "../../src/appearance/types";
import type { OpsContext } from "../../src/ops/context";
import { dryRun } from "../ops/dryRun";
import { withSession } from "../ops/session";
import type { Command, OptionValue } from "./types";
import { AS_OPTION, boolOpt, positional, readTextValue, SITE_OPTION, strOpt, table, usage, YES_OPTION } from "./util";

// `agentcrm modules …` and `agentcrm appearance …` — the CLI side of
// Settings → Modules and Settings → Appearance (src/ops/modules.ts,
// src/ops/appearance.ts). Every change is workspace-wide: without --yes
// the command runs the op on an in-memory copy and prints the plan
// (needsConfirmation: true); --yes applies it.

// --- modules ----------------------------------------------------------

const CASCADE_OPTION = { name: "cascade", type: "boolean" as const, description: "enable / disable: also enable the dependencies / disable the dependents." };

function parseJsonValue(raw: string, name: string): unknown {
  const text = readTextValue(raw, name);
  try {
    return JSON.parse(text);
  } catch (err) {
    usage(`--${name} is not valid JSON: ${(err as Error).message}`, `Example: --${name} '{"targets":{"owner":50000}}' or --${name} @config.json`);
  }
}

export const modulesCommand: Command = {
  name: "modules",
  usage: "modules <list|get|enable|disable|config> …",
  summary:
    "Workspace modules (Settings → Modules): built-in features (dashboard, deals, reports, forms, tasks, automations, integrations, assistant…) and installed extension modules. Disabling hides pages, navigation, widgets and owned objects for everyone without deleting data. enable / disable / config set print a plan unless --yes.",
  subcommands: [
    { name: "list", usage: "modules list", summary: "Modules with category, source, enabled / required state and dependencies." },
    { name: "get", usage: "modules get <id>", summary: "One module (dependents, missing dependencies, owned objects, settings section)." },
    { name: "enable", usage: "modules enable <id> [--cascade] [--yes]", summary: "Enable a module (--cascade also enables its dependencies).", writes: true },
    { name: "disable", usage: "modules disable <id> [--cascade] [--yes]", summary: "Disable a module (--cascade also disables the modules depending on it).", writes: true, destructive: true },
    { name: "config", usage: "modules config get <id> | modules config set <id> --value <json|@file|-> [--yes] | modules config set <id> --clear [--yes]", summary: "Read or replace a module's configuration (JSON ≤ 256 KB, never secrets).", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, YES_OPTION, CASCADE_OPTION, { name: "value", type: "string", description: "config set: the new configuration as JSON, @file or - (stdin)." }, { name: "clear", type: "boolean", description: "config set: remove the module's configuration." }],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    const apply = options.yes === true;
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/modules")).listModules(ctx), (rows) =>
          table(
            rows.map((m) => ({ ...m, enabled: m.enabled ? "yes" : "no", required: m.required ? "yes" : "", dependsOn: m.dependsOn.join(",") })),
            ["id", "name", "category", "source", "enabled", "required", "dependsOn"],
          ));
      case "get": {
        const id = positional(positionals, 1, "module id", "modules get <id>");
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/modules")).getModule(ctx, id));
      }
      case "enable":
      case "disable": {
        const id = positional(positionals, 1, "module id", `modules ${action} <id> [--cascade] [--yes]`);
        const enabled = action === "enable";
        const cascade = boolOpt(options, "cascade");
        return withSession(io, options, { lock: apply }, async ({ ctx }) => {
          const { setModuleEnabled } = await import("../../src/ops/modules");
          if (apply) return setModuleEnabled(ctx, id, enabled, { cascade });
          const { result } = await dryRun(ctx, (copy) => setModuleEnabled(copy, id, enabled, { cascade }));
          return { needsConfirmation: true as const, plan: result };
        }, (r) =>
          "needsConfirmation" in r
            ? `${r.plan.changed.length ? `Would ${action}: ${r.plan.changed.map((c) => `${c.id} → ${c.enabled ? "on" : "off"}`).join(", ")}` : `${id} is already ${enabled ? "enabled" : "disabled"}`}.\nNothing changed — re-run with --yes once the user agrees.`
            : r.changed.length
              ? `Changed: ${r.changed.map((c) => `${c.id} → ${c.enabled ? "on" : "off"}`).join(", ")}`
              : `${id} was already ${enabled ? "enabled" : "disabled"}.`);
      }
      case "config": {
        const sub = positionals[1];
        const id = positional(positionals, 2, "module id", "modules config <get|set> <id>");
        if (sub === "get") return withSession(io, options, {}, async ({ ctx }) => ({ id, config: (await import("../../src/ops/modules")).getModuleConfig(ctx, id) ?? null }));
        if (sub !== "set") usage(`Unknown modules config action "${sub ?? ""}".`, "Use modules config get <id> or modules config set <id> --value <json>.");
        const clear = boolOpt(options, "clear");
        const raw = strOpt(options, "value");
        if (!clear && raw === undefined) usage("modules config set needs --value <json|@file|-> (or --clear).");
        const value = clear ? null : parseJsonValue(raw!, "value");
        return withSession(io, options, { lock: apply }, async ({ ctx }) => {
          const mod = await import("../../src/ops/modules");
          mod.getModule(ctx, id);
          const before = mod.getModuleConfig(ctx, id) ?? null;
          if (apply) return { id, config: (await mod.setModuleConfig(ctx, id, value)) ?? null, before };
          const { result } = await dryRun(ctx, (copy) => mod.setModuleConfig(copy, id, value));
          return { needsConfirmation: true as const, plan: { id, before, after: result ?? null } };
        });
      }
      default:
        usage(`Unknown modules action "${action}".`, "Use list, get, enable, disable or config.");
    }
  },
};

// --- appearance -------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function imageDataUrl(file: string): string {
  const abs = resolve(file);
  if (!existsSync(abs) || !statSync(abs).isFile()) usage(`${file} does not exist.`);
  const type = IMAGE_TYPES[extname(abs).toLowerCase()];
  if (!type) usage(`${file}: unsupported image type.`, `Use ${Object.keys(IMAGE_TYPES).join(", ")} (≤ 200 KB).`);
  return `data:${type};base64,${readFileSync(abs).toString("base64")}`;
}

// What the CLI prints: images and CSS summarised unless --full.
function view(a: Appearance, full: boolean): Record<string, unknown> {
  if (full) return { ...a };
  const { logo, favicon, customCss, ...rest } = a;
  const kb = (s: string) => Math.round(((s.length - s.indexOf(",") - 1) * 3) / 4 / 1024);
  return {
    ...rest,
    logo: logo ? `${logo.slice(5, logo.indexOf(";"))}, ${kb(logo)} KB` : null,
    favicon: favicon ? `${favicon.slice(5, favicon.indexOf(";"))}, ${kb(favicon)} KB` : null,
    customCss: customCss ? `${new TextEncoder().encode(customCss).length} bytes` : null,
  };
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

const SET_FLAGS: [option: string, key: keyof Appearance][] = [
  ["accent", "accent"],
  ["neutral", "neutral"],
  ["radius", "radius"],
  ["density", "density"],
  ["font", "font"],
  ["sidebar", "sidebar"],
  ["mode", "defaultMode"],
  ["buttons", "buttons"],
  ["contrast", "contrast"],
  ["theme", "themeId"],
];

function setPatch(options: Record<string, OptionValue>): AppearancePatch {
  const patch: Record<string, unknown> = {};
  for (const [opt, key] of SET_FLAGS) {
    const v = strOpt(options, opt);
    if (v === undefined) continue;
    patch[key] = v === "null" || v === "" ? null : v;
  }
  if (!Object.keys(patch).length) usage("appearance set needs at least one value.", `Options: ${SET_FLAGS.map(([o]) => `--${o}`).join(", ")} ("null" resets one to its default).`);
  return patch as AppearancePatch;
}

export const appearanceCommand: Command = {
  name: "appearance",
  usage: "appearance <get|presets|set|preset|logo|favicon|css|reset> …",
  summary:
    "Workspace appearance (Settings → Appearance) for every user: accent color (a full scale is generated from one hex), neutral grays, radius, density, font, sidebar style, default light / dark mode, buttons, contrast, presets and theme extensions, logo, favicon, custom CSS. Changes print a plan (before → after) unless --yes.",
  subcommands: [
    { name: "get", usage: "appearance get [--full]", summary: "The effective appearance (defaults ← selected theme ← workspace values)." },
    { name: "presets", usage: "appearance presets", summary: "Built-in presets and installed theme extensions." },
    { name: "set", usage: "appearance set [--accent <#hex>] [--neutral zinc|slate|stone|gray|neutral] [--radius none|sm|md|lg|xl] [--density compact|comfortable] [--font <id>] [--sidebar default|dark|accent] [--mode system|light|dark] [--buttons neutral|accent] [--contrast normal|high] [--theme <id>] [--yes]", summary: "Change some values (\"null\" resets one).", writes: true },
    { name: "preset", usage: "appearance preset <id> [--yes]", summary: "Apply a preset (default, ocean, forest, sunset, graphite, rose, high-contrast) or an installed theme; logo, favicon and custom CSS are kept.", writes: true },
    { name: "logo", usage: "appearance logo <file.png|svg|jpg> [--yes] | appearance logo --remove [--yes]", summary: "Set or remove the workspace logo (≤ 200 KB).", writes: true },
    { name: "favicon", usage: "appearance favicon <file> [--yes] | appearance favicon --remove [--yes]", summary: "Set or remove the favicon (≤ 200 KB).", writes: true },
    { name: "css", usage: "appearance css <file.css|-> [--yes] | appearance css --remove [--yes]", summary: "Replace the custom CSS of the workspace (≤ 50 KB, plain CSS).", writes: true },
    { name: "reset", usage: "appearance reset [--branding] [--yes]", summary: "Back to the defaults (keeps logo / favicon unless --branding).", writes: true, destructive: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "accent", type: "string", description: "set: accent color #rrggbb." },
    { name: "neutral", type: "string", description: "set: zinc, slate, stone, gray or neutral." },
    { name: "radius", type: "string", description: "set: none, sm, md, lg or xl." },
    { name: "density", type: "string", description: "set: compact or comfortable." },
    { name: "font", type: "string", description: "set: system (no network) or a Google font id (inter, geist, roboto, ibm-plex-sans…)." },
    { name: "sidebar", type: "string", description: "set: default, dark or accent." },
    { name: "mode", type: "string", description: "set: default color mode — system, light or dark (users who never chose)." },
    { name: "buttons", type: "string", description: "set: primary buttons neutral or accent." },
    { name: "contrast", type: "string", description: "set: normal or high." },
    { name: "theme", type: "string", description: "set: installed theme extension id to use (\"null\" clears it)." },
    { name: "remove", type: "boolean", description: "logo / favicon / css: remove it." },
    { name: "branding", type: "boolean", description: "reset: also remove the logo and favicon." },
    { name: "full", type: "boolean", description: "get: include the logo / favicon data URLs and the custom CSS." },
  ],
  async run({ io, options, positionals }) {
    const [action = "get"] = positionals;
    const apply = options.yes === true;
    const full = boolOpt(options, "full");
    const appearance = () => import("../../src/ops/appearance");

    // Every write: dry run → plan, or apply with --yes.
    const change = (describe: string, op: (ctx: OpsContext) => Promise<Appearance>) =>
      withSession(io, options, { lock: apply }, async ({ ctx }) => {
        const before = view((await appearance()).getAppearance(ctx), full);
        if (apply) {
          const after = view(await op(ctx), full);
          return { applied: describe, appearance: after, changes: diff(before, after) };
        }
        const { result } = await dryRun(ctx, op);
        return { needsConfirmation: true as const, plan: { action: describe, changes: diff(before, view(result, full)) } };
      }, (r) => {
        const changes = r.plan ? r.plan.changes : r.changes ?? {};
        const lines = Object.entries(changes).map(([k, c]) => `  ${k}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
        return [`${r.plan ? "Would apply" : "Applied"}: ${describe}`, ...(lines.length ? lines : ["  (no visible change)"]), ...(r.plan ? ["Nothing changed — re-run with --yes once the user agrees."] : [])].join("\n");
      });

    switch (action) {
      case "get":
        return withSession(io, options, {}, async ({ ctx }) => {
          const ops = await appearance();
          const doc = ops.getAppearanceDoc(ctx);
          const explicit = doc ? Object.keys(doc).filter((k) => !["id", "updatedAt", "updatedBy"].includes(k)) : [];
          return { appearance: view(ops.getAppearance(ctx), full), explicit };
        }, (r) => Object.entries(r.appearance).map(([k, v]) => `${k.padEnd(12)} ${v ?? "—"}${r.explicit.includes(k) ? "" : "  (default)"}`).join("\n"));
      case "presets":
        return withSession(io, options, {}, async ({ ctx }) => (await appearance()).listPresets(ctx), (rows) =>
          table(rows.map((p) => ({ id: p.id, name: p.name, source: p.source, accent: p.values.accent ?? "", enabled: p.enabled === undefined ? "" : p.enabled ? "yes" : "no", description: p.description })), ["id", "name", "source", "accent", "enabled", "description"]));
      case "set": {
        const patch = setPatch(options);
        return change(`set ${Object.entries(patch).map(([k, v]) => `${k}=${v ?? "default"}`).join(", ")}`, async (ctx) => (await appearance()).setAppearance(ctx, patch));
      }
      case "preset": {
        const id = positional(positionals, 1, "preset or theme id", "appearance preset <id>");
        return change(`preset ${id}`, async (ctx) => (await appearance()).applyPreset(ctx, id));
      }
      case "logo":
      case "favicon": {
        const remove = boolOpt(options, "remove");
        const file = positionals[1];
        if (!remove && !file) usage(`appearance ${action} needs an image file (or --remove).`, `Usage: agentcrm appearance ${action} <file.png|svg|jpg>`);
        const dataUrl = remove ? null : imageDataUrl(file!);
        return change(remove ? `remove the ${action}` : `${action} ${file}`, async (ctx) => (await appearance()).setLogo(ctx, dataUrl, { kind: action }));
      }
      case "css": {
        const remove = boolOpt(options, "remove");
        const source = positionals[1];
        if (!remove && !source) usage("appearance css needs a CSS file or - (stdin), or --remove.");
        const css = remove ? null : readTextValue(source === "-" ? "-" : `@${source}`, "file");
        return change(remove ? "remove the custom CSS" : `custom CSS from ${source === "-" ? "stdin" : source}`, async (ctx) => (await appearance()).setAppearance(ctx, { customCss: css }));
      }
      case "reset": {
        const branding = boolOpt(options, "branding");
        return change(`reset${branding ? " (including logo and favicon)" : ""}`, async (ctx) => (await appearance()).resetAppearance(ctx, { branding }));
      }
      default:
        usage(`Unknown appearance action "${action}".`, "Use get, presets, set, preset, logo, favicon, css or reset.");
    }
  },
};
