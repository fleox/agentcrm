// Typed read helpers over the DataStore collections (internal to ops/).

import type { Activity, Automation, AutomationRun, CrmRecord, CrmSettings, CrmUser, LeadForm, ObjectDef, Pipeline, ViewDef } from "../core/types";
import type { DataStore, StoredDoc } from "../data/types";
import { OpsError } from "./context";

export const asDoc = <T extends { id: string }>(value: T): StoredDoc => value as unknown as StoredDoc;

export function objectsOf(store: DataStore): ObjectDef[] {
  return store.list("objects") as unknown as ObjectDef[];
}

export function objectOf(store: DataStore, id: string): ObjectDef | undefined {
  return store.get("objects", id) as unknown as ObjectDef | undefined;
}

export function requireObject(store: DataStore, id: string): ObjectDef {
  const o = objectOf(store, id);
  if (!o) {
    const known = objectsOf(store).map((x) => x.id).join(", ");
    throw new OpsError("notFound", `Unknown object "${id}".${known ? ` Objects: ${known}.` : ""}`);
  }
  return o;
}

export function recordsOf(store: DataStore, object?: string, opts: { includeDeleted?: boolean } = {}): CrmRecord[] {
  const all = store.list("records") as unknown as CrmRecord[];
  return all.filter((r) => (!object || r.object === object) && (opts.includeDeleted || !r.deletedAt));
}

export function recordOf(store: DataStore, id: string): CrmRecord | undefined {
  return store.get("records", id) as unknown as CrmRecord | undefined;
}

export function requireRecord(store: DataStore, id: string, opts: { includeDeleted?: boolean } = {}): CrmRecord {
  const r = recordOf(store, id);
  if (!r || (r.deletedAt && !opts.includeDeleted)) throw new OpsError("notFound", `Record "${id}" not found.`);
  return r;
}

export function activitiesOf(store: DataStore, opts: { includeDeleted?: boolean } = {}): Activity[] {
  const all = store.list("activities") as unknown as Activity[];
  return opts.includeDeleted ? all : all.filter((a) => !a.deletedAt);
}

export function requireActivity(store: DataStore, id: string): Activity {
  const a = store.get("activities", id) as unknown as Activity | undefined;
  if (!a || a.deletedAt) throw new OpsError("notFound", `Activity "${id}" not found.`);
  return a;
}

export function pipelinesOf(store: DataStore, object?: string): Pipeline[] {
  const all = store.list("pipelines") as unknown as Pipeline[];
  return object ? all.filter((p) => p.object === object) : all;
}

export function requirePipeline(store: DataStore, id: string): Pipeline {
  const p = store.get("pipelines", id) as unknown as Pipeline | undefined;
  if (!p) throw new OpsError("notFound", `Pipeline "${id}" not found.`);
  return p;
}

export function viewsOf(store: DataStore, object?: string): ViewDef[] {
  const all = store.list("views") as unknown as ViewDef[];
  return object ? all.filter((v) => v.object === object) : all;
}

export function usersOf(store: DataStore): CrmUser[] {
  return store.list("users") as unknown as CrmUser[];
}

export function userOf(store: DataStore, id: string): CrmUser | undefined {
  return store.get("users", id) as unknown as CrmUser | undefined;
}

export function settingsDoc(store: DataStore): CrmSettings | undefined {
  return store.get("settings", "general") as unknown as CrmSettings | undefined;
}

export function automationsOf(store: DataStore): Automation[] {
  return store.list("automations") as unknown as Automation[];
}

export function formsOf(store: DataStore): LeadForm[] {
  return store.list("forms") as unknown as LeadForm[];
}

export function automationRunsOf(store: DataStore): AutomationRun[] {
  return store.list("automationRuns") as unknown as AutomationRun[];
}

// Deep, mutable copy of a frozen stored doc.
export function thaw<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
