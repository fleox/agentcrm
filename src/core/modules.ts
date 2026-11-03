// Module catalog — the pure (React-free) description of every built-in
// module of this build. A module is a feature (src/features/<id>/) or an
// object module (`deals`: hides an object + everything built on it) that
// an admin can switch off for the whole workspace (Settings → Modules,
// `agentcrm modules`, the set_module_enabled AI tool).
//
// Each src/features/<id>/index.ts sets `module: moduleMeta("<id>")` so the
// admin shell and src/ops/modules.ts (Node, CLI) read the same metadata.
// External modules (src/extensions/) describe themselves in their
// manifest.json with the same fields.

export const MODULE_CATEGORIES = ["core", "sales", "productivity", "automation", "integrations", "ai", "customisation"] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export interface ModuleMeta {
  // i18n keys (namespace "customize" for built-ins).
  name: string;
  description: string;
  // lucide-react icon name ("LayoutDashboard", "Handshake"…).
  icon: string;
  category: ModuleCategory;
  // Cannot be disabled.
  required?: boolean;
  // Module ids that must be enabled for this one to be enabled.
  dependsOn?: string[];
  // Enabled on a fresh workspace (default true).
  defaultEnabled?: boolean;
  // Object ids this module owns: hidden (not deleted) while disabled.
  objects?: string[];
}

export interface BuiltinModule extends ModuleMeta {
  id: string;
  // English name / description (CLI, AI tools — the UI uses the i18n keys).
  label: string;
  summary: string;
  // Settings section to link to from the module card (paths.settings(id)).
  settingsSection?: string;
}

function mod(id: string, m: Omit<BuiltinModule, "id" | "name" | "description">): BuiltinModule {
  return { id, name: `customize:modules.catalog.${id}.name`, description: `customize:modules.catalog.${id}.description`, ...m };
}

// Order = display order inside a category.
export const BUILTIN_MODULES: readonly BuiltinModule[] = [
  mod("records", { label: "Records", summary: "Objects, records, table & kanban views, record pages.", icon: "Database", category: "core", required: true }),
  mod("search", { label: "Search", summary: "Cmd+K command palette over records and navigation.", icon: "Search", category: "core", required: true }),
  mod("settings", { label: "Settings", summary: "Workspace settings, data model, users, import / export.", icon: "Settings", category: "core", required: true }),
  mod("setup", { label: "Setup & access", summary: "Setup wizard, sign-in, data backend, admin hosting, security.", icon: "ShieldCheck", category: "core", required: true }),
  mod("dashboard", { label: "Dashboard", summary: "Home dashboard with KPIs, charts and widgets.", icon: "LayoutDashboard", category: "sales" }),
  mod("deals", { label: "Deals & pipelines", summary: "The deals object, pipelines, kanban board, pipeline reports and widgets.", icon: "Handshake", category: "sales", objects: ["deals"], settingsSection: "pipelines" }),
  mod("reports", { label: "Reports", summary: "Reports page: pipeline, forecast, won / lost, activity, lead sources.", icon: "BarChart3", category: "sales" }),
  mod("forms", { label: "Lead forms", summary: "Static lead capture forms and inbox ingestion.", icon: "FileInput", category: "sales" }),
  mod("tasks", { label: "Tasks", summary: "My tasks / all tasks page and the task overlays.", icon: "CheckSquare", category: "productivity" }),
  mod("automations", { label: "Automations", summary: "Trigger → conditions → actions workflows and their run log.", icon: "Zap", category: "automation" }),
  mod("integrations", { label: "Email & calendar", summary: "Gmail, Google Calendar and Outlook sync through browser OAuth.", icon: "Plug", category: "integrations", settingsSection: "integrations" }),
  mod("assistant", { label: "AI assistant", summary: "Chat panel driving the AI tool catalog with your own Claude API key.", icon: "Sparkles", category: "ai", settingsSection: "assistant" }),
  mod("customize", { label: "Customisation", summary: "Modules, extensions and appearance settings.", icon: "Palette", category: "customisation", required: true, settingsSection: "modules" }),
];

export function builtinModule(id: string): BuiltinModule | undefined {
  return BUILTIN_MODULES.find((m) => m.id === id);
}

// The `module` field of a built-in Feature.
export function moduleMeta(id: string): ModuleMeta {
  const m = builtinModule(id);
  if (!m) throw new Error(`Unknown built-in module "${id}" (add it to src/core/modules.ts).`);
  const { id: _id, label: _l, summary: _s, settingsSection: _ss, ...meta } = m;
  return meta;
}

export const REQUIRED_MODULES: readonly string[] = BUILTIN_MODULES.filter((m) => m.required).map((m) => m.id);

// `config/modules` document (workspace state).
export interface ModulesConfigDoc {
  id: "modules";
  // Disabled built-in module ids (external modules use their extension's
  // `enabled` flag).
  disabled: string[];
  // Per-module configuration (JSON, never secrets).
  config: Record<string, unknown>;
  updatedAt?: number;
}

export const MODULES_CONFIG_ID = "modules";

// Built-in modules disabled by default on a fresh workspace (none today).
export function defaultDisabledModules(): string[] {
  return BUILTIN_MODULES.filter((m) => m.defaultEnabled === false).map((m) => m.id);
}

// Disabled built-in ids from a raw config doc (required ones never are).
export function disabledFromDoc(doc: unknown): Set<string> {
  const raw = doc && typeof doc === "object" ? (doc as { disabled?: unknown }).disabled : undefined;
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : defaultDisabledModules();
  return new Set(list.filter((id) => !REQUIRED_MODULES.includes(id)));
}
