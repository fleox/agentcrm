// The runtime API of external extensions — `@agent-crm/runtime`.
//
// External bundles can't import the admin's modules directly (they would
// ship their own React, store, i18n…). The admin instead publishes ONE
// object on globalThis.__AGENTCRM_RUNTIME__ (installed here, first import
// of main.tsx): `api` (the named exports of `@agent-crm/runtime`) and
// `modules` (react, react/jsx-runtime, react-dom, react-dom/client,
// react-i18next, lucide-react). The stubs in public/runtime/*.js re-export
// them; the import map of index.html (and the loader's specifier rewrite)
// points bare imports at the stubs → one React instance.
//
// Adding an export = add it to `runtimeApi` below + public/runtime/
// agentcrm-runtime.js + types/agentcrm-runtime.d.ts + bump
// EXTENSION_API_VERSION (src/extensions/api.ts). runtime.test.ts keeps
// the three lists identical.

import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import * as ReactI18next from "react-i18next";
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as opsModule from "../ops";
import {
  useActivities,
  useCan,
  useCollection,
  useCrm,
  useCurrentUser,
  useModuleConfig,
  useObject,
  useObjects,
  useOps,
  usePipelines,
  useRecord,
  useRecords,
  useSettings,
  useUsers,
  useViews,
} from "../app/CrmDataContext";
import { useModuleEnabled } from "../app/featureRegistry";
import { paths, recordHref } from "../app/paths";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  confirmDialog,
  Drawer,
  Dropdown,
  EmptyState,
  FieldInput,
  FieldValue,
  FormField,
  IconButton,
  Input,
  Kbd,
  Label,
  Markdown,
  Modal,
  ObjectIcon,
  PageHeader,
  Select,
  Spinner,
  Switch,
  Table,
  Tabs,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tooltip,
  Tr,
} from "../components/ui";
import { plugins } from "../core/pluginRegistry";
import { coerceFieldValue, formatCurrency, formatFieldValue, formatNumber, isEmptyFieldValue, recordLabel } from "../core/fields";
import { newId } from "../core/ids";
import i18n, { activeLocale, intlLocale, registerI18nNamespace, type NamespaceBundles } from "../i18n";
import { toast } from "../shared/lib/toast";
import { cn, formatDate, formatDateTime, formatRelative } from "../shared/lib/utils";
import { registerAiTool, type AiTool } from "../ai/tools";
import { registerAutomationAction } from "../ops/automations/extensionActions";
import { getAppliedAppearance, subscribeAppliedAppearance } from "../appearance/apply";
import type { Appearance, ThemeDefinition } from "../appearance/types";
import { EXTENSION_API_VERSION, EXTENSION_MIN_API_VERSION, RUNTIME_GLOBAL } from "./api";
import type { ModuleDefinition } from "./types";

function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

function defineTheme(def: ThemeDefinition): ThemeDefinition {
  return def;
}

// Adds (merges) i18n bundles for a namespace — `t("<ns>:key")`.
function addBundles(namespace: string, bundles: NamespaceBundles): void {
  registerI18nNamespace(namespace, bundles);
}

function useAppearance(): Appearance {
  return React.useSyncExternalStore(subscribeAppliedAppearance, getAppliedAppearance, getAppliedAppearance);
}

function addAction(hook: string, fn: (...args: never[]) => void | Promise<void>, priority?: number): () => void {
  return plugins.addAction(hook, fn, priority);
}
function removeAction(hook: string, fn: (...args: never[]) => void | Promise<void>): void {
  plugins.removeAction(hook, fn);
}
function addFilter<T = unknown>(hook: string, fn: (value: T, ...args: unknown[]) => T | Promise<T>, priority?: number): () => void {
  return plugins.addFilter(hook, fn, priority);
}
function removeFilter<T = unknown>(hook: string, fn: (value: T, ...args: unknown[]) => T | Promise<T>): void {
  plugins.removeFilter(hook, fn);
}
function doAction(hook: string, ...args: unknown[]): Promise<void> {
  return plugins.doAction(hook, ...args);
}
function applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T> {
  return plugins.applyFilters(hook, value, ...args);
}
function registerTool(tool: AiTool): () => void {
  return registerAiTool(tool);
}

// The named exports of `@agent-crm/runtime` (keep in lockstep with
// public/runtime/agentcrm-runtime.js and types/agentcrm-runtime.d.ts).
export const runtimeApi = {
  // Versioning + definitions
  apiVersion: EXTENSION_API_VERSION,
  minApiVersion: EXTENSION_MIN_API_VERSION,
  defineModule,
  defineTheme,
  // The whole business engine (src/ops/): listRecords, createRecord,
  // addNote, moveStage, getModuleConfig, setModuleConfig…
  ops: opsModule,
  // Data hooks (live)
  useCrm,
  useOps,
  useCan,
  useCurrentUser,
  useCollection,
  useObjects,
  useObject,
  useRecords,
  useRecord,
  useActivities,
  usePipelines,
  useViews,
  useUsers,
  useSettings,
  useModuleConfig,
  useModuleEnabled,
  useAppearance,
  // Router (the admin's instance — HashRouter)
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
  Link,
  NavLink,
  paths,
  recordHref,
  // Plugin registry (CRM actions: record.created, stage.changed…)
  addAction,
  removeAction,
  addFilter,
  removeFilter,
  doAction,
  applyFilters,
  registerAiTool: registerTool,
  registerAutomationAction,
  // UI kit (src/components/ui)
  Button,
  IconButton,
  Input,
  Textarea,
  Select,
  Label,
  FormField,
  Checkbox,
  Switch,
  Modal,
  Drawer,
  Card,
  Badge,
  Avatar,
  Tabs,
  Tooltip,
  Spinner,
  EmptyState,
  PageHeader,
  Kbd,
  Dropdown,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  FieldValue,
  FieldInput,
  ObjectIcon,
  Markdown,
  confirmDialog,
  toast,
  cn,
  newId,
  // i18n
  i18n,
  addBundles,
  activeLocale,
  intlLocale,
  // Formatters (src/core/fields.ts, shared/lib/utils.ts)
  formatFieldValue,
  formatCurrency,
  formatNumber,
  formatDate,
  formatDateTime,
  formatRelative,
  recordLabel,
  coerceFieldValue,
  isEmptyFieldValue,
};

export type RuntimeApi = typeof runtimeApi;

export interface RuntimeGlobal {
  apiVersion: string;
  api: RuntimeApi;
  // Modules behind the bare-specifier stubs.
  modules: {
    react: typeof React;
    "react/jsx-runtime": typeof ReactJsxRuntime;
    "react-dom": typeof ReactDom;
    "react-dom/client": typeof ReactDomClient;
    "react-i18next": typeof ReactI18next;
    "lucide-react"?: Record<string, unknown>;
  };
  // Loads optional modules a bundle needs before it is imported.
  prepare(specifiers: string[]): Promise<void>;
}

let installed: RuntimeGlobal | null = null;

export function installRuntime(): RuntimeGlobal {
  const g = globalThis as unknown as Record<string, RuntimeGlobal | undefined>;
  if (installed && g[RUNTIME_GLOBAL] === installed) return installed;
  const runtime: RuntimeGlobal = {
    apiVersion: EXTENSION_API_VERSION,
    api: runtimeApi,
    modules: { react: React, "react/jsx-runtime": ReactJsxRuntime, "react-dom": ReactDom, "react-dom/client": ReactDomClient, "react-i18next": ReactI18next },
    async prepare(specifiers) {
      // lucide-react is large: it is a separate chunk, fetched only when a
      // bundle imports it.
      if (specifiers.includes("lucide-react") && !runtime.modules["lucide-react"]) {
        // The UMD build is a separate module from the ES build the admin
        // tree-shakes, so the full icon set stays out of the main bundle.
        const m = (await import("lucide-react/dist/umd/lucide-react.min.js")) as Record<string, unknown> & { default?: Record<string, unknown> };
        runtime.modules["lucide-react"] = m.default && typeof m.default === "object" && "createLucideIcon" in m.default ? m.default : m;
      }
    },
  };
  g[RUNTIME_GLOBAL] = runtime;
  installed = runtime;
  return runtime;
}

installRuntime();
