import { EXTENSION_API_VERSION, EXTENSION_LIMITS, EXTENSION_MIN_API_VERSION, RUNTIME_SPECIFIERS } from "../../src/extensions/api";
import { bundleImports, ExtensionPackageError, validateManifest } from "../../src/extensions/package";
import type { ExtensionDoc, ExtensionManifest } from "../../src/extensions/types";
import type { RawPackage } from "./extPackage";
import { nodeImportBundle } from "./extensions";

// `agentcrm ext check` — validates an extension exactly as the admin will
// load it: manifest (ids, apiVersion range, keys), sizes, bundle imports
// (runtime specifiers only), default export; then installs it in a
// throw-away in-memory CRM (demo data), loads it through the real loader
// (src/extensions/loader.ts) with the Node importer, and reports what it
// registers: routes, navigation, slots, settings page, AI tools (each
// one without required inputs is smoke-called on the demo data),
// automation actions, hooks, theme values (validated like
// Settings → Appearance).

export interface CheckIssue {
  code: string;
  message: string;
  hint?: string;
}

export interface CheckReport {
  valid: boolean;
  source: string;
  sourceType: RawPackage["sourceType"];
  id: string | null;
  kind: "module" | "theme" | null;
  name: string | null;
  version: string | null;
  apiVersion: string | null;
  hostApi: { version: string; min: string };
  size: { bundle: number; style: number; zip?: number };
  imports: string[];
  errors: CheckIssue[];
  warnings: CheckIssue[];
  loaded: boolean;
  registered?: {
    routes: string[];
    navItems: { id: string; to: string; label: string }[];
    slots: Record<string, string[]>;
    settingsPage: boolean;
    i18n: { en: number; fr: number };
    aiTools: { name: string; mutating: boolean; description: string }[];
    automationActions: { id: string; label: string; objects?: string[] }[];
    hooks: { actions: string[]; filters: string[] };
  };
  toolCalls?: { name: string; ok: boolean; error?: string }[];
  theme?: { name: string; appearance: Record<string, unknown>; css: number };
}

const bytes = (s: string | undefined) => (s ? new TextEncoder().encode(s).length : 0);

function countKeys(o: unknown): number {
  if (!o || typeof o !== "object") return 0;
  return Object.values(o as Record<string, unknown>).reduce<number>((n, v) => n + (v && typeof v === "object" ? countKeys(v) : 1), 0);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref?.())]);
}

export async function checkExtension(raw: RawPackage, opts: { kind?: "module" | "theme"; callTools?: boolean } = {}): Promise<CheckReport> {
  const errors: CheckIssue[] = [...raw.problems];
  const warnings: CheckIssue[] = [];
  const bundle = raw.files["bundle.js"];
  const style = raw.files["style.css"];
  const m = (raw.manifest && typeof raw.manifest === "object" ? raw.manifest : {}) as Record<string, unknown>;
  const report: CheckReport = {
    valid: false,
    source: raw.source,
    sourceType: raw.sourceType,
    id: typeof m.id === "string" ? m.id : null,
    kind: m.kind === "module" || m.kind === "theme" ? m.kind : null,
    name: typeof m.name === "string" ? m.name : null,
    version: typeof m.version === "string" ? m.version : null,
    apiVersion: typeof m.apiVersion === "string" ? m.apiVersion : null,
    hostApi: { version: EXTENSION_API_VERSION, min: EXTENSION_MIN_API_VERSION },
    size: { bundle: bytes(bundle), style: bytes(style), ...(raw.zipBytes !== undefined ? { zip: raw.zipBytes } : {}) },
    imports: bundle ? bundleImports(bundle) : [],
    errors,
    warnings,
    loaded: false,
  };

  // 1. Manifest.
  let manifest: ExtensionManifest | null = null;
  if (raw.manifest) {
    try {
      manifest = validateManifest(raw.manifest);
    } catch (err) {
      if (err instanceof ExtensionPackageError) {
        if (err.code === "incompatibleApi") errors.push({ code: "incompatibleApi", message: err.message, hint: `Set "apiVersion" between ${EXTENSION_MIN_API_VERSION} and ${EXTENSION_API_VERSION} (manifest.json and the default export).` });
        else for (const d of err.details?.length ? err.details : [err.message]) errors.push({ code: "manifest", message: d });
      } else throw err;
    }
  }
  if (manifest && opts.kind && manifest.kind !== opts.kind) errors.push({ code: "kind", message: `Expected a ${opts.kind}, the manifest says ${manifest.kind}.` });
  if (manifest && !manifest.description) warnings.push({ code: "description", message: "manifest.json has no description (shown in Settings → Modules and the install plan)." });
  if (manifest && !manifest.author) warnings.push({ code: "author", message: "manifest.json has no author (shown in the install plan, helps admins trust it)." });

  // 2. Files.
  if (bundle !== undefined) {
    if (!bundle.trim()) errors.push({ code: "missingEntry", message: "bundle.js is empty." });
    if (bytes(bundle) > EXTENSION_LIMITS.bundle) errors.push({ code: "tooLarge", message: `bundle.js is ${(bytes(bundle) / 1024 / 1024).toFixed(2)} MB — the limit is ${EXTENSION_LIMITS.bundle / 1024 / 1024} MB.`, hint: "Keep react, react-i18next, lucide-react and @agent-crm/runtime external (vite.config.ts)." });
    const foreign = report.imports.filter((s) => !(RUNTIME_SPECIFIERS as readonly string[]).includes(s));
    if (foreign.length) errors.push({ code: "imports", message: `bundle.js imports modules the admin doesn't provide: ${foreign.join(", ")}.`, hint: `Bundle them, or import only from ${RUNTIME_SPECIFIERS.join(", ")}.` });
    if (/\bjsxDEV\b|react\/jsx-dev-runtime/.test(bundle)) errors.push({ code: "devJsx", message: "bundle.js uses the development JSX runtime.", hint: 'Build in production mode (esbuild: { jsx: "automatic", jsxDev: false }).' });
    if (!/\bexport\s*(?:default\b|\{[^}]*\bas\s+default\b)/.test(bundle)) errors.push({ code: "noDefaultExport", message: "bundle.js has no default export.", hint: "export default defineModule({...}) / defineTheme({...})." });
  } else if (!errors.some((e) => e.code === "notBuilt")) {
    errors.push({ code: "missingEntry", message: "The package has no bundle.js." });
  }
  if (manifest?.style && style === undefined) errors.push({ code: "missingStyle", message: 'manifest.json declares "style": "style.css" but there is no style.css.', hint: "Add src/style.css (projects) or style.css next to bundle.js." });
  if (style !== undefined && bytes(style) > EXTENSION_LIMITS.style) errors.push({ code: "tooLarge", message: `style.css is larger than ${EXTENSION_LIMITS.style / 1024} KB.` });
  for (const f of raw.ignored) warnings.push({ code: "ignored", message: `${f} is not part of the package (only manifest.json, bundle.js and style.css are).${/style\.css$/.test(f) ? ' Declare "style": "style.css" in manifest.json to ship it.' : ""}` });

  // 3. Load it like the admin, in a throw-away CRM.
  if (!errors.length && manifest && bundle) await loadInSandbox(report, manifest, { "bundle.js": bundle, ...(style ? { "style.css": style } : {}) }, opts);
  report.valid = errors.length === 0;
  return report;
}

async function loadInSandbox(report: CheckReport, manifest: ExtensionManifest, files: ExtensionDoc["files"], opts: { callTools?: boolean }): Promise<void> {
  const importBundle = await nodeImportBundle();
  const [{ createMemoryStore }, { createOpsContext }, { createPluginRegistry, plugins }, { seedCrm }, { usersOf }, loader, registry, aiTools, actions, features, themes, schema] = await Promise.all([
    import("../../src/data/memory"),
    import("../../src/ops/context"),
    import("../../src/core/pluginRegistry"),
    import("../../src/ops/seed"),
    import("../../src/ops/store"),
    import("../../src/extensions/loader"),
    import("../../src/extensions/registry"),
    import("../../src/ai/tools"),
    import("../../src/ops/automations/extensionActions"),
    import("../../src/app/featureRegistry"),
    import("../../src/appearance/themes"),
    import("../../src/appearance/schema"),
  ]);
  const store = createMemoryStore();
  await store.ready();
  const sandboxPlugins = createPluginRegistry(() => undefined);
  const system = createOpsContext(store, null, { plugins: sandboxPlugins });
  await seedCrm(system, { admin: { name: "Check Admin", email: "check@example.com" }, demo: true, name: "Extension check" });
  const admin = createOpsContext(store, usersOf(store).find((u) => u.role === "admin") ?? null, { plugins: sandboxPlugins });
  const now = Date.now();
  const doc: ExtensionDoc = { id: manifest.id, kind: manifest.kind, manifest, enabled: true, files, installedAt: now, updatedAt: now };
  await store.write([{ op: "set", collection: "extensions", doc: doc as unknown as import("../../src/data/types").StoredDoc }]);
  const { BUILTIN_MODULES } = await import("../../src/core/modules");
  const missingDeps = (manifest.dependsOn ?? []).filter((d) => !BUILTIN_MODULES.some((b) => b.id === d));
  for (const d of missingDeps) report.warnings.push({ code: "dependency", message: `Depends on "${d}", which is not a built-in module: install that extension first on the real CRM.` });

  const toolsBefore = new Set(aiTools.listAiTools().map((t) => t.name));
  const actionsBefore = new Set(actions.listAutomationActions().map((a) => a.id));
  const hooksBefore = plugins.listHooks();
  const sync = await loader.syncExtensions(store, { importBundle, onError: () => undefined });
  try {
    const failure = sync.failed.find((f) => f.id === manifest.id);
    if (failure || registry.getLoadedExtension(manifest.id)?.status !== "loaded") {
      const reason = failure?.error ?? registry.getLoadedExtension(manifest.id)?.error ?? "not loaded";
      report.errors.push({ code: "load", message: `The bundle failed to load: ${reason}`, hint: "Check the default export (id and apiVersion equal to manifest.json), AI tool names (snake_case, unique) and automation action ids (<moduleId>.<action>)." });
      return;
    }
    report.loaded = true;
    if (manifest.kind === "theme") {
      const theme = themes.getExternalTheme(manifest.id);
      if (!theme) {
        report.errors.push({ code: "theme", message: "The theme did not register." });
        return;
      }
      const { errors } = schema.validateAppearancePatch(theme.appearance);
      for (const e of errors) report.errors.push({ code: "appearance", message: `Theme appearance: ${e}` });
      for (const k of ["logo", "favicon", "themeId", "preset"] as const) if (k in (theme.appearance ?? {})) report.warnings.push({ code: "appearance", message: `Theme appearance sets "${k}" — themes should leave it to the workspace.` });
      report.theme = { name: theme.name, appearance: { ...theme.appearance }, css: bytes(theme.css) };
      return;
    }
    const feature = features.getAllFeatures().find((f) => f.id === manifest.id);
    const slots: Record<string, string[]> = {};
    for (const [name, items] of Object.entries(feature?.slots ?? {})) {
      if (!items) continue;
      slots[name] = Array.isArray(items) ? items.map((x, i) => (x && typeof x === "object" && "id" in x ? String((x as { id: unknown }).id) : `#${i}`)) : ["(component)"];
    }
    const en = (feature?.i18n?.en ?? {}) as Record<string, unknown>;
    const fr = (feature?.i18n as { fr?: Record<string, unknown> } | undefined)?.fr;
    const tools = aiTools.listAiTools().filter((t) => !toolsBefore.has(t.name));
    const hooksAfter = plugins.listHooks();
    report.registered = {
      routes: (feature?.routes ?? []).map((r) => r.path),
      navItems: (feature?.navItems ?? []).map((n) => ({ id: n.id, to: n.to, label: n.label })),
      slots,
      settingsPage: typeof feature?.settingsPage === "function" || (typeof feature?.settingsPage === "object" && feature?.settingsPage !== null),
      i18n: { en: countKeys(en), fr: countKeys(fr) },
      aiTools: tools.map((t) => ({ name: t.name, mutating: t.mutating, description: t.description })),
      automationActions: actions.listAutomationActions().filter((a) => !actionsBefore.has(a.id)).map((a) => ({ id: a.id, label: a.label, ...(a.objects ? { objects: a.objects } : {}) })),
      hooks: { actions: hooksAfter.actions.filter((h) => !hooksBefore.actions.includes(h)), filters: hooksAfter.filters.filter((h) => !hooksBefore.filters.includes(h)) },
    };
    const r = report.registered;
    if (!r.routes.length && !r.navItems.length && !Object.keys(r.slots).length && !r.settingsPage && !r.aiTools.length && !r.automationActions.length && !r.hooks.actions.length && !r.hooks.filters.length) {
      report.warnings.push({ code: "empty", message: "The module registers nothing (no route, slot, settings page, AI tool, automation action or hook)." });
    }
    if (r.i18n.en && !fr) report.warnings.push({ code: "i18n", message: "No French bundle (feature.i18n.fr): French users see the English strings." });
    for (const n of r.navItems) {
      if (!r.routes.includes(n.to)) report.warnings.push({ code: "nav", message: `Navigation entry "${n.id}" points to ${n.to}, which no route of this module serves.` });
      const key = n.label.startsWith(`${manifest.id}:`) ? n.label.slice(manifest.id.length + 1) : null;
      if (key && !key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), en)) report.warnings.push({ code: "i18n", message: `Navigation label "${n.label}" has no English string.` });
    }
    for (const t of tools) {
      const snake = manifest.id.replace(/-/g, "_");
      if (!t.name.includes(snake) && !t.name.startsWith(snake.split("_")[0])) report.warnings.push({ code: "toolName", message: `AI tool "${t.name}" doesn't start with the module id: prefix it to avoid clashes with other extensions.` });
      if ((t.description ?? "").length < 20) report.warnings.push({ code: "toolDescription", message: `AI tool "${t.name}" needs a clearer description (the model reads it to decide when to call it).` });
    }
    for (const a of r.automationActions) if (!a.id.startsWith(`${manifest.id}.`)) report.warnings.push({ code: "actionId", message: `Automation action "${a.id}" should be namespaced "${manifest.id}.<action>".` });
    // Smoke-call the tools that need no input, on the demo data.
    if (opts.callTools !== false) {
      report.toolCalls = [];
      for (const t of tools) {
        if (t.inputSchema.required?.length) continue;
        try {
          await withTimeout(Promise.resolve(aiTools.callTool(admin, t.name, {})), 10_000);
          report.toolCalls.push({ name: t.name, ok: true });
        } catch (err) {
          const message = (err as Error)?.message ?? String(err);
          report.toolCalls.push({ name: t.name, ok: false, error: message });
          report.warnings.push({ code: "toolCall", message: `AI tool "${t.name}" failed when called with {} on demo data: ${message}` });
        }
      }
    }
  } finally {
    registry.deactivateExtension(manifest.id);
  }
}
