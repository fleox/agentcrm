// WordPress-style filter/action registry (adapted from cms-ia
// src/core/pluginRegistry.ts, see SHARED.md). Ops emit actions at
// well-known points (record.created, stage.changed…); the automations
// engine, integrations and the UI subscribe to them. Filters let a
// subscriber alter a value the engine is about to use.
//
// Lower priority runs first, ties broken by registration order. A
// failing callback never stops the others (logged, then swallowed) —
// a broken automation must not make a record write fail.
//
// There is one default registry (`plugins`) shared by the process; tests
// and multi-tenant callers create their own with createPluginRegistry()
// and pass it in the OpsContext.

import type { Activity, CrmRecord } from "./types";
import type { OpsContextLike } from "./opsContextLike";

type FilterFn<T = unknown> = (value: T, ...args: unknown[]) => T | Promise<T>;
type ActionFn = (...args: never[]) => void | Promise<void>;

interface Entry<F> {
  fn: F;
  priority: number;
  order: number;
}

// Payloads of the actions emitted by src/ops/. The first argument of every
// action callback is the OpsContext the op ran with (so a subscriber can
// write through the same store / user).
export interface CrmActionPayloads {
  "record.created": { record: CrmRecord };
  "record.updated": { record: CrmRecord; before: CrmRecord; changed: string[] };
  "record.deleted": { record: CrmRecord; hard: boolean };
  "record.restored": { record: CrmRecord };
  "stage.changed": { record: CrmRecord; pipelineId: string; from: string | null; to: string };
  "activity.created": { activity: Activity };
  "activity.updated": { activity: Activity; before: Activity };
  "activity.completed": { activity: Activity };
}

export type CrmActionName = keyof CrmActionPayloads;

export type CrmActionHandler<K extends CrmActionName> = (
  ctx: OpsContextLike,
  payload: CrmActionPayloads[K],
) => void | Promise<void>;

export interface PluginRegistry {
  addFilter<T = unknown>(hook: string, fn: FilterFn<T>, priority?: number): () => void;
  removeFilter<T = unknown>(hook: string, fn: FilterFn<T>): void;
  applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T>;
  applyFiltersSync<T>(hook: string, value: T, ...args: unknown[]): T;
  // Typed CRM actions…
  addAction<K extends CrmActionName>(hook: K, fn: CrmActionHandler<K>, priority?: number): () => void;
  // …and free-form ones (features may define their own hooks).
  addAction(hook: string, fn: (...args: never[]) => void | Promise<void>, priority?: number): () => void;
  removeAction(hook: string, fn: ActionFn): void;
  doAction<K extends CrmActionName>(hook: K, ctx: OpsContextLike, payload: CrmActionPayloads[K]): Promise<void>;
  doAction(hook: string, ...args: unknown[]): Promise<void>;
  hasAction(hook: string): boolean;
  reset(): void;
  listHooks(): { filters: string[]; actions: string[] };
}

export function createPluginRegistry(onError: (hook: string, err: unknown) => void = defaultOnError): PluginRegistry {
  const filters = new Map<string, Entry<FilterFn>[]>();
  const actions = new Map<string, Entry<ActionFn>[]>();
  let counter = 0;

  const sorted = <T extends { priority: number; order: number }>(list: T[]) =>
    [...list].sort((a, b) => a.priority - b.priority || a.order - b.order);

  const registry: PluginRegistry = {
    addFilter(hook, fn, priority = 10) {
      const list = filters.get(hook) ?? [];
      list.push({ fn: fn as FilterFn, priority, order: counter++ });
      filters.set(hook, list);
      return () => registry.removeFilter(hook, fn);
    },
    removeFilter(hook, fn) {
      const list = filters.get(hook);
      if (list) filters.set(hook, list.filter((e) => e.fn !== (fn as FilterFn)));
    },
    async applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T> {
      let current = value;
      for (const e of sorted(filters.get(hook) ?? [])) {
        try {
          current = (await e.fn(current, ...args)) as T;
        } catch (err) {
          onError(hook, err);
        }
      }
      return current;
    },
    applyFiltersSync<T>(hook: string, value: T, ...args: unknown[]): T {
      let current = value;
      for (const e of sorted(filters.get(hook) ?? [])) {
        const next = e.fn(current, ...args);
        if (next instanceof Promise) throw new Error(`Filter "${hook}" must be synchronous; got a Promise.`);
        current = next as T;
      }
      return current;
    },
    addAction(hook: string, fn: ActionFn, priority = 10) {
      const list = actions.get(hook) ?? [];
      list.push({ fn, priority, order: counter++ });
      actions.set(hook, list);
      return () => registry.removeAction(hook, fn);
    },
    removeAction(hook, fn) {
      const list = actions.get(hook);
      if (list) actions.set(hook, list.filter((e) => e.fn !== fn));
    },
    async doAction(hook: string, ...args: unknown[]) {
      for (const e of sorted(actions.get(hook) ?? [])) {
        try {
          await (e.fn as (...a: unknown[]) => void | Promise<void>)(...args);
        } catch (err) {
          onError(hook, err);
        }
      }
    },
    hasAction(hook) {
      return (actions.get(hook)?.length ?? 0) > 0;
    },
    reset() {
      filters.clear();
      actions.clear();
      counter = 0;
    },
    listHooks() {
      return { filters: [...filters.keys()], actions: [...actions.keys()] };
    },
  } as PluginRegistry;
  return registry;
}

function defaultOnError(hook: string, err: unknown): void {
  console.error(`[plugins] "${hook}" callback failed:`, err);
}

// Process-wide default registry.
export const plugins: PluginRegistry = createPluginRegistry();
