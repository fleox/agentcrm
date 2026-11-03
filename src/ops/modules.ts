// Modules: switch built-in features (and installed extension modules) on
// and off for the whole workspace, with dependency checks, plus a small
// per-module configuration store.
//
// State: `config/modules` = { id: "modules", disabled: string[] (built-in
// ids), config: { [moduleId]: JSON }, updatedAt }. External modules are
// enabled through their extension document (`extensions/<id>.enabled`).
// Disabling never deletes data: objects owned by a disabled module are
// only hidden (see disabledObjectIds).

import { BUILTIN_MODULES, MODULES_CONFIG_ID, REQUIRED_MODULES, builtinModule, disabledFromDoc, type ModuleCategory, type ModulesConfigDoc } from "../core/modules";
import type { DocMutation, DataStore, StoredDoc } from "../data/types";
import type { ExtensionDoc } from "../extensions/types";
import { isCompatibleApiVersion } from "../extensions/api";
import { assertCan, OpsError, type OpsContext } from "./context";
import { assertNoSecrets } from "./settings";
import { extensionDocOf, extensionDocsOf } from "./store";

export interface ModuleInfo {
  id: string;
  source: "builtin" | "extension";
  // English name / description (the admin uses nameKey / descriptionKey).
  name: string;
  description: string;
  nameKey?: string;
  descriptionKey?: string;
  icon: string;
  category: ModuleCategory;
  required: boolean;
  enabled: boolean;
  dependsOn: string[];
  // Modules that depend on this one (enabled or not).
  dependents: string[];
  // Dependencies currently disabled or not installed.
  missingDependencies: string[];
  objects: string[];
  settingsSection?: string;
  version?: string;
  // External module whose bundle targets an unsupported API version.
  incompatible?: boolean;
}

function configDoc(store: DataStore): ModulesConfigDoc | undefined {
  return store.get("config", MODULES_CONFIG_ID) as unknown as ModulesConfigDoc | undefined;
}

function moduleExtensions(store: DataStore): ExtensionDoc[] {
  return extensionDocsOf(store).filter((e) => e.kind === "module");
}

// Pure state resolution (no permission check) — used by the admin shell.
export function moduleStates(store: DataStore): ModuleInfo[] {
  const disabled = disabledFromDoc(configDoc(store));
  const list: ModuleInfo[] = BUILTIN_MODULES.map((m) => ({
    id: m.id,
    source: "builtin",
    name: m.label,
    description: m.summary,
    nameKey: m.name,
    descriptionKey: m.description,
    icon: m.icon,
    category: m.category,
    required: !!m.required,
    enabled: !disabled.has(m.id),
    dependsOn: m.dependsOn ?? [],
    dependents: [],
    missingDependencies: [],
    objects: m.objects ?? [],
    ...(m.settingsSection ? { settingsSection: m.settingsSection } : {}),
  }));
  for (const e of moduleExtensions(store)) {
    const incompatible = !isCompatibleApiVersion(e.manifest.apiVersion);
    list.push({
      id: e.id,
      source: "extension",
      name: e.manifest.name,
      description: e.manifest.description,
      icon: e.manifest.icon ?? "Puzzle",
      category: e.manifest.category ?? "customisation",
      required: false,
      enabled: !!e.enabled && !incompatible,
      dependsOn: e.manifest.dependsOn ?? [],
      dependents: [],
      missingDependencies: [],
      objects: [],
      version: e.manifest.version,
      ...(incompatible ? { incompatible: true } : {}),
    });
  }
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of list) {
    for (const d of m.dependsOn) {
      byId.get(d)?.dependents.push(m.id);
      if (!byId.get(d)?.enabled) m.missingDependencies.push(d);
    }
  }
  return list;
}

export function isModuleEnabled(store: DataStore, id: string): boolean {
  const m = moduleStates(store).find((x) => x.id === id);
  // Unknown ids (features without module metadata) are always on.
  return m ? m.enabled : true;
}

// Objects hidden because their module is disabled.
export function disabledObjectIds(store: DataStore): Set<string> {
  const out = new Set<string>();
  for (const m of moduleStates(store)) if (!m.enabled) for (const o of m.objects) out.add(o);
  return out;
}

export function listModules(ctx: OpsContext): ModuleInfo[] {
  assertCan(ctx, "settings.read");
  return moduleStates(ctx.store);
}

export function getModule(ctx: OpsContext, id: string): ModuleInfo {
  const m = listModules(ctx).find((x) => x.id === id);
  if (!m) throw new OpsError("notFound", `Unknown module "${id}". Modules: ${listModules(ctx).map((x) => x.id).join(", ")}.`);
  return m;
}

export interface SetModuleResult {
  id: string;
  enabled: boolean;
  // Every module whose state changed (cascade included).
  changed: { id: string; enabled: boolean }[];
}

// Enables / disables a module. Disabling is refused while enabled modules
// depend on it, enabling while a dependency is off — unless `cascade`
// (then dependents are disabled / dependencies enabled too).
export async function setModuleEnabled(ctx: OpsContext, id: string, enabled: boolean, opts: { cascade?: boolean } = {}): Promise<SetModuleResult> {
  assertCan(ctx, "modules.write");
  const states = moduleStates(ctx.store);
  const byId = new Map(states.map((m) => [m.id, m]));
  const target = byId.get(id);
  if (!target) throw new OpsError("notFound", `Unknown module "${id}". Modules: ${states.map((m) => m.id).join(", ")}.`);
  if (!enabled && target.required) throw new OpsError("invalid", `"${target.name}" is required and can't be disabled. Required modules: ${REQUIRED_MODULES.join(", ")}.`);
  if (enabled && target.incompatible) throw new OpsError("invalid", `"${target.name}" targets an unsupported extension API version — install an updated version.`);

  // Closure of what must change.
  const toChange = new Map<string, boolean>();
  const visit = (mid: string) => {
    const m = byId.get(mid);
    if (!m || toChange.has(mid)) return;
    toChange.set(mid, enabled);
    const next = enabled ? m.dependsOn : m.dependents;
    for (const n of next) {
      const other = byId.get(n);
      if (enabled && !other) throw new OpsError("conflict", `"${target.name}" depends on "${n}", which is not installed.`, { missing: [n] });
      if (!other || other.enabled === enabled) continue;
      if (!opts.cascade) {
        const blockers = next.filter((x) => byId.get(x) && byId.get(x)!.enabled !== enabled);
        throw new OpsError(
          "conflict",
          enabled
            ? `"${m.name}" needs ${blockers.map((b) => `"${byId.get(b)!.name}"`).join(", ")} — enable ${blockers.length > 1 ? "them" : "it"} first (or pass cascade).`
            : `${blockers.map((b) => `"${byId.get(b)!.name}"`).join(", ")} depend${blockers.length > 1 ? "" : "s"} on "${m.name}" — disable ${blockers.length > 1 ? "them" : "it"} first (or pass cascade).`,
          { blockers },
        );
      }
      if (!enabled && other.required) throw new OpsError("conflict", `Required module "${other.name}" depends on "${m.name}".`);
      visit(n);
    }
  };
  visit(id);

  const changed = [...toChange].filter(([mid, on]) => byId.get(mid)!.enabled !== on).map(([mid, on]) => ({ id: mid, enabled: on }));
  if (!changed.length) return { id, enabled, changed: [] };
  const mutations: DocMutation[] = [];
  const builtinChanges = changed.filter((c) => byId.get(c.id)!.source === "builtin");
  if (builtinChanges.length) {
    const current = configDoc(ctx.store);
    const disabled = disabledFromDoc(current);
    for (const c of builtinChanges) {
      if (c.enabled) disabled.delete(c.id);
      else disabled.add(c.id);
    }
    const list = BUILTIN_MODULES.map((m) => m.id).filter((m) => disabled.has(m));
    if (current) mutations.push({ op: "patch", collection: "config", id: MODULES_CONFIG_ID, fields: { disabled: list, updatedAt: ctx.now() } });
    else mutations.push({ op: "set", collection: "config", doc: { id: MODULES_CONFIG_ID, disabled: list, config: {}, updatedAt: ctx.now() } as StoredDoc });
  }
  for (const c of changed.filter((x) => byId.get(x.id)!.source === "extension")) {
    mutations.push({ op: "patch", collection: "extensions", id: c.id, fields: { enabled: c.enabled, updatedAt: ctx.now() } });
  }
  await ctx.store.write(mutations, { message: `${enabled ? "Enable" : "Disable"} module ${id}` });
  ctx.log?.(`modules: ${changed.map((c) => `${c.id}=${c.enabled ? "on" : "off"}`).join(", ")}`);
  return { id, enabled, changed };
}

function assertKnownModule(store: DataStore, id: string): void {
  if (!builtinModule(id) && !extensionDocOf(store, id)) throw new OpsError("notFound", `Unknown module "${id}".`);
}

// Per-module configuration (JSON, no secrets). Readable by everyone.
export function getModuleConfig<T = unknown>(ctx: OpsContext, id: string): T | undefined {
  assertCan(ctx, "settings.read");
  return configDoc(ctx.store)?.config?.[id] as T | undefined;
}

const MAX_MODULE_CONFIG = 256 * 1024;

// Keys that hold credentials in third-party module configs (compared
// case-insensitively, `_` / `-` ignored) on top of the connector secret keys
// refused by assertNoSecrets. Module config is readable by every CRM user.
const MODULE_SECRET_KEYS: ReadonlySet<string> = new Set([
  "apikey", "apisecret", "secret", "secretkey", "clientsecret", "privatekey", "accesstoken", "authtoken", "bearertoken", "refreshtoken", "password", "token", "webhooksecret",
]);

function assertNoModuleSecrets(value: unknown, path = ""): void {
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (MODULE_SECRET_KEYS.has(k.toLowerCase().replace(/[_-]/g, "")) && v !== "" && v != null) {
      throw new OpsError("validation", `Refusing to store the secret "${path}${k}" in the module configuration: every CRM user can read it. Keep secrets out of the CRM data.`);
    }
    assertNoModuleSecrets(v, `${path}${k}.`);
  }
}

export async function setModuleConfig<T = unknown>(ctx: OpsContext, id: string, value: T | null): Promise<T | undefined> {
  assertCan(ctx, "modules.write");
  assertKnownModule(ctx.store, id);
  if (value !== null && value !== undefined) {
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new OpsError("validation", "Module configuration must be JSON-serialisable.");
    }
    if (json === undefined) throw new OpsError("validation", "Module configuration must be JSON-serialisable.");
    if (json.length > MAX_MODULE_CONFIG) throw new OpsError("validation", `Module configuration is larger than ${MAX_MODULE_CONFIG / 1024} KB.`);
    assertNoSecrets(value);
    assertNoModuleSecrets(value);
  }
  const current = configDoc(ctx.store);
  const next = value === null || value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
  if (current) {
    await ctx.store.write([{ op: "patch", collection: "config", id: MODULES_CONFIG_ID, fields: { [`config.${id}`]: next, updatedAt: ctx.now() } }], { message: `Configure module ${id}` });
  } else {
    await ctx.store.write([{ op: "set", collection: "config", doc: { id: MODULES_CONFIG_ID, disabled: [], config: next === undefined ? {} : { [id]: next }, updatedAt: ctx.now() } as StoredDoc }], { message: `Configure module ${id}` });
  }
  return getModuleConfig<T>(ctx, id);
}
