// Types of the extension system (v0.2). Type-only: safe to import from
// src/ops/ and the CLI.

import type { ComponentType } from "react";
import type { AiTool } from "../ai/tools";
import type { ModuleCategory } from "../core/modules";
import type { CrmActionHandler, CrmActionName } from "../core/pluginRegistry";
import type { Feature } from "../features/types";
import type { AutomationActionDef } from "../ops/automations/extensionActions";
import type { ThemeDefinition } from "../appearance/types";

export type { ThemeDefinition } from "../appearance/types";
export type { AutomationActionDef, AutomationActionParam, AutomationActionRunInput } from "../ops/automations/extensionActions";

export type ExtensionKind = "module" | "theme";

// manifest.json at the root of the ZIP.
export interface ExtensionManifest {
  id: string;
  kind: ExtensionKind;
  name: string;
  version: string;
  apiVersion: string;
  description: string;
  author?: string;
  homepage?: string;
  // Always "bundle.js" (ESM, default-exports defineModule / defineTheme).
  entry: "bundle.js";
  // Optional stylesheet injected while the extension is enabled.
  style?: "style.css";
  // Module metadata (Settings → Modules), kind "module" only.
  icon?: string;
  category?: ModuleCategory;
  dependsOn?: string[];
}

export interface ExtensionFiles {
  "bundle.js": string;
  "style.css"?: string;
}

// What a ZIP contains once read (src/extensions/package.ts).
export interface ExtensionPackage {
  manifest: ExtensionManifest;
  files: ExtensionFiles;
}

// Document of the `extensions` collection.
export interface ExtensionDoc {
  id: string;
  kind: ExtensionKind;
  manifest: ExtensionManifest;
  enabled: boolean;
  files: ExtensionFiles;
  installedAt: number;
  installedBy?: string;
  updatedAt: number;
  previousVersion?: string;
}

// What `register(api)` of a module receives. Everything registered
// through it is removed automatically when the module is disabled or
// uninstalled.
export interface ModuleApi {
  readonly moduleId: string;
  addAction<K extends CrmActionName>(hook: K, fn: CrmActionHandler<K>, priority?: number): () => void;
  addAction(hook: string, fn: (...args: never[]) => void | Promise<void>, priority?: number): () => void;
  addFilter<T = unknown>(hook: string, fn: (value: T, ...args: unknown[]) => T | Promise<T>, priority?: number): () => void;
  registerAiTool(tool: AiTool): () => void;
  registerAutomationAction(def: AutomationActionDef): () => void;
  // Runs when the module is unloaded.
  onDispose(fn: () => void): void;
}

export type ModuleFeature = Partial<Omit<Feature, "id" | "module" | "settingsPage">>;

// Default export of a module bundle (`defineModule({...})`).
export interface ModuleDefinition {
  id: string;
  apiVersion: string;
  // Routes, nav items, slots, i18n, onStart — merged into the feature
  // registry exactly like a built-in feature (i18n namespace = id).
  feature?: ModuleFeature;
  register?(api: ModuleApi): void | (() => void);
  aiTools?: AiTool[];
  automationActions?: AutomationActionDef[];
  // Settings → Modules → <module>.
  settingsPage?: ComponentType;
}

export type ExtensionDefinition = ModuleDefinition | ThemeDefinition;

export type ExtensionStatus = "loaded" | "error" | "disabled" | "skipped" | "incompatible";

// Live state of one installed extension in this tab (registry.ts).
export interface LoadedExtension {
  id: string;
  kind: ExtensionKind;
  version: string;
  status: ExtensionStatus;
  error?: string;
  // Fingerprint of what was loaded (version + bundle hash).
  fingerprint?: string;
}
