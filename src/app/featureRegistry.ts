// Holds the features of this build (registered once by main.tsx from
// src/features/index.ts) plus the features of loaded extension modules
// (src/extensions/registry.ts), and aggregates their routes, nav items and
// slots. Kept separate from src/features/index.ts so feature code can read
// slots without an import cycle.
//
// Modules (v0.2): a feature whose module is disabled in the workspace
// (`config/modules`, src/ops/modules.ts) is filtered out of getFeatures()
// / getSlot() — live: connectModuleState(store) subscribes to the store
// and notifies; React code reads through useFeatures() / useSlot() (or
// useFeatureRegistryVersion()) to re-render.

import { useSyncExternalStore } from "react";
import { registerI18nNamespace } from "../i18n";
import type { Feature, FeatureSlots, SlotName } from "../features/types";
import type { DataStore } from "../data/types";
import { moduleStates, type ModuleInfo } from "../ops/modules";

let builtins: Feature[] = [];
const externals = new Map<string, Feature>();
let disabled = new Set<string>();
let modules: ModuleInfo[] = [];
let version = 0;
let cache: { version: number; enabled: Feature[] } | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  cache = null;
  for (const l of [...listeners]) l();
}

export function registerFeatures(list: Feature[]): void {
  builtins = list;
  for (const f of list) registerI18nNamespace(f.id, f.i18n);
  notify();
}

// Extension modules (src/extensions/registry.ts). Returns the unregister.
export function registerExternalFeature(feature: Feature): () => void {
  if (builtins.some((f) => f.id === feature.id)) throw new Error(`Feature id "${feature.id}" is taken by a built-in feature.`);
  externals.set(feature.id, feature);
  registerI18nNamespace(feature.id, feature.i18n);
  notify();
  return () => {
    if (externals.get(feature.id) === feature) {
      externals.delete(feature.id);
      notify();
    }
  };
}

// Every registered feature, enabled or not.
export function getAllFeatures(): Feature[] {
  return [...builtins, ...externals.values()];
}

// Enabled features (built-ins whose module is on + loaded extensions).
export function getFeatures(): Feature[] {
  if (cache && cache.version === version) return cache.enabled;
  const enabled = getAllFeatures().filter((f) => !f.module || f.module.required || !disabled.has(f.id));
  cache = { version, enabled };
  return enabled;
}

export function getFeature(id: string): Feature | undefined {
  return getFeatures().find((f) => f.id === id);
}

export function isModuleEnabled(id: string): boolean {
  return !disabled.has(id);
}

// Modules (built-in + installed extensions) as last read from the store.
export function getModuleStates(): ModuleInfo[] {
  return modules;
}

// Disabled module ids (built-ins from config/modules + disabled extensions).
export function getDisabledModules(): ReadonlySet<string> {
  return disabled;
}

function readModules(store: DataStore): void {
  const next = moduleStates(store);
  const nextDisabled = new Set(next.filter((m) => !m.enabled).map((m) => m.id));
  const changed = JSON.stringify(next) !== JSON.stringify(modules);
  modules = next;
  if (changed || [...nextDisabled].join() !== [...disabled].join()) {
    disabled = nextDisabled;
    notify();
  }
}

let unsubscribeStore: (() => void) | null = null;

// Follows `config/modules` + `extensions` of a store (replaces any
// previous binding). Returns the unsubscribe.
export function connectModuleState(store: DataStore): () => void {
  unsubscribeStore?.();
  readModules(store);
  const off = store.subscribe((changed) => {
    if (changed.has("config") || changed.has("extensions")) readModules(store);
  });
  unsubscribeStore = () => {
    off();
    unsubscribeStore = null;
  };
  return unsubscribeStore;
}

// Tests only.
export function setDisabledModules(ids: Iterable<string>): void {
  disabled = new Set(ids);
  notify();
}

export function subscribeFeatures(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function featureRegistryVersion(): number {
  return version;
}

type SlotItem<K extends SlotName> = NonNullable<FeatureSlots[K]> extends Array<infer T> ? T : NonNullable<FeatureSlots[K]>;

// Every enabled feature's contributions to a slot, ordered by `order`.
export function getSlot<K extends SlotName>(name: K): SlotItem<K>[] {
  const out: SlotItem<K>[] = [];
  for (const f of getFeatures()) {
    const v = f.slots?.[name];
    if (v === undefined) continue;
    if (Array.isArray(v)) out.push(...(v as SlotItem<K>[]));
    else out.push(v as SlotItem<K>);
  }
  return out.sort((a, b) => ((a as { order?: number }).order ?? 100) - ((b as { order?: number }).order ?? 100));
}

// Re-renders the caller when modules / extensions change.
export function useFeatureRegistryVersion(): number {
  return useSyncExternalStore(subscribeFeatures, featureRegistryVersion, featureRegistryVersion);
}

export function useFeatures(): Feature[] {
  useFeatureRegistryVersion();
  return getFeatures();
}

// Hook version of getSlot (live).
export function useSlot<K extends SlotName>(name: K): SlotItem<K>[] {
  useFeatureRegistryVersion();
  return getSlot(name);
}

export function useModuleEnabled(id: string): boolean {
  useFeatureRegistryVersion();
  return isModuleEnabled(id);
}

export function useModuleStates(): ModuleInfo[] {
  useFeatureRegistryVersion();
  return modules;
}
