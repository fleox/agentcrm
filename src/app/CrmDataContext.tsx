// Live CRM data for React. Wraps one DataStore: every collection is
// exposed through useSyncExternalStore with per-collection versioning, so
// a component only re-renders when a collection it reads changes. Writes
// go through src/ops/ with the OpsContext from useOps() — never call
// store.write() from a component.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { recordLabel } from "../core/fields";
import { buildSearchIndex, type CrmSearchIndex } from "../core/search";
import type { Activity, Automation, AutomationRun, CrmRecord, CrmSettings, CrmUser, LeadForm, ObjectDef, Pipeline, ViewDef } from "../core/types";
import type { CollectionName, DataStore, StoredDoc } from "../data/types";
import { intlLocale } from "../i18n";
import { can as canDo, createOpsContext, type OpsAction, type OpsContext } from "../ops/context";
import { DEFAULT_SETTINGS } from "../ops/settings";
import { FieldContext, type FieldContextValue } from "../components/ui/fieldContext";
import { recordHref } from "./paths";

// ─── Live store ─────────────────────────────────────────────────────────

class LiveStore {
  private versions = new Map<CollectionName, number>();
  private cache = new Map<CollectionName, { version: number; docs: StoredDoc[] }>();
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(readonly store: DataStore) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.store.subscribe((changed) => {
      for (const c of changed) this.versions.set(c, (this.versions.get(c) ?? 0) + 1);
      for (const l of [...this.listeners]) l();
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  version(c: CollectionName): number {
    return this.versions.get(c) ?? 0;
  }

  // Stable array reference until the collection changes.
  docs(c: CollectionName): StoredDoc[] {
    const v = this.version(c);
    const hit = this.cache.get(c);
    if (hit && hit.version === v) return hit.docs;
    const docs = this.store.list(c);
    this.cache.set(c, { version: v, docs });
    return docs;
  }
}

// ─── Context ────────────────────────────────────────────────────────────

export interface CrmContextValue {
  store: DataStore;
  live: LiveStore;
  user: CrmUser;
  ops: OpsContext;
  can(action: OpsAction): boolean;
}

const CrmContext = createContext<CrmContextValue | null>(null);

export function CrmDataProvider({ store, user, children }: { store: DataStore; user: CrmUser; children: ReactNode }) {
  const liveRef = useRef<LiveStore | null>(null);
  if (!liveRef.current || liveRef.current.store !== store) liveRef.current = new LiveStore(store);
  const live = liveRef.current;
  useEffect(() => {
    live.start();
    return () => live.stop();
  }, [live]);
  const value = useMemo<CrmContextValue>(() => {
    const ops = createOpsContext(store, user, { log: (m) => console.info(`[ops] ${m}`) });
    return { store, live, user, ops, can: (a) => canDo(user, a) };
  }, [store, live, user]);
  return (
    <CrmContext.Provider value={value}>
      <FieldContextBridge>{children}</FieldContextBridge>
    </CrmContext.Provider>
  );
}

export function useCrm(): CrmContextValue {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error("useCrm must be used inside <CrmDataProvider>");
  return ctx;
}

export function useOptionalCrm(): CrmContextValue | null {
  return useContext(CrmContext);
}

// OpsContext of the signed-in user: pass it to every src/ops/ call.
export function useOps(): OpsContext {
  return useCrm().ops;
}

export function useCan(action: OpsAction): boolean {
  return useCrm().can(action);
}

export function useCurrentUser(): CrmUser {
  return useCrm().user;
}

// ─── Collection hooks ───────────────────────────────────────────────────

export function useCollection<T = StoredDoc>(c: CollectionName): T[] {
  const { live } = useCrm();
  const getSnapshot = useCallback(() => live.docs(c), [live, c]);
  return useSyncExternalStore(live.subscribe, getSnapshot, getSnapshot) as unknown as T[];
}

export function useDoc<T = StoredDoc>(c: CollectionName, id: string | undefined): T | undefined {
  const docs = useCollection(c);
  const { store } = useCrm();
  // `docs` in deps re-reads after any change of the collection.
  return useMemo(() => (id ? (store.get(c, id) as unknown as T | undefined) : undefined), [store, c, id, docs]);
}

const STANDARD_ORDER = ["companies", "people", "deals"];

// Objects: standard ones first (companies, people, deals), then custom by label.
export function useObjects(): ObjectDef[] {
  const objects = useCollection<ObjectDef>("objects");
  return useMemo(
    () =>
      [...objects].sort((a, b) => {
        const ia = STANDARD_ORDER.indexOf(a.id);
        const ib = STANDARD_ORDER.indexOf(b.id);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.labelPlural.localeCompare(b.labelPlural);
      }),
    [objects],
  );
}

export function useObject(id: string | undefined): ObjectDef | undefined {
  return useDoc<ObjectDef>("objects", id);
}

// Records of one object (soft-deleted excluded unless asked).
export function useRecords(objectId: string | undefined, opts: { includeDeleted?: boolean } = {}): CrmRecord[] {
  const all = useCollection<CrmRecord>("records");
  const includeDeleted = !!opts.includeDeleted;
  return useMemo(() => all.filter((r) => (!objectId || r.object === objectId) && (includeDeleted || !r.deletedAt)), [all, objectId, includeDeleted]);
}

export function useRecord(id: string | undefined): CrmRecord | undefined {
  return useDoc<CrmRecord>("records", id);
}

// Activities, most recent first; with a target, only those attached to it.
export function useActivities(target?: string | { id: string } | null, opts: { includeDeleted?: boolean } = {}): Activity[] {
  const all = useCollection<Activity>("activities");
  const targetId = typeof target === "string" ? target : target?.id;
  const includeDeleted = !!opts.includeDeleted;
  return useMemo(
    () =>
      all
        .filter((a) => (includeDeleted || !a.deletedAt) && (!targetId || a.targets.some((t) => t.id === targetId)))
        .sort((a, b) => b.createdAt - a.createdAt),
    [all, targetId, includeDeleted],
  );
}

export function usePipelines(objectId?: string): Pipeline[] {
  const all = useCollection<Pipeline>("pipelines");
  return useMemo(() => (objectId ? all.filter((p) => p.object === objectId) : all), [all, objectId]);
}

// Views visible to the current user (shared + own) for an object.
export function useViews(objectId: string | undefined): ViewDef[] {
  const all = useCollection<ViewDef>("views");
  const { user } = useCrm();
  return useMemo(() => all.filter((v) => v.object === objectId && (v.shared || !v.ownerId || v.ownerId === user.id)), [all, objectId, user.id]);
}

export function useUsers(opts: { includeDisabled?: boolean } = {}): CrmUser[] {
  const all = useCollection<CrmUser>("users");
  const includeDisabled = !!opts.includeDisabled;
  return useMemo(() => all.filter((u) => includeDisabled || !u.disabled).sort((a, b) => a.name.localeCompare(b.name)), [all, includeDisabled]);
}

export function useSettings(): CrmSettings {
  const docs = useCollection<CrmSettings>("settings");
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...(docs.find((d) => d.id === "general") ?? {}) }), [docs]);
}

export function useConfigDoc<T extends object = Record<string, unknown>>(id: string): (T & { id: string }) | undefined {
  return useDoc<T & { id: string }>("config", id);
}

export function useAutomations(): Automation[] {
  return useCollection<Automation>("automations");
}

export function useAutomationRuns(): AutomationRun[] {
  return useCollection<AutomationRun>("automationRuns");
}

export function useForms(): LeadForm[] {
  return useCollection<LeadForm>("forms");
}

// id → display label of any record.
export function useRecordLabel(): (id: string) => string | undefined {
  const objects = useCollection<ObjectDef>("objects");
  const records = useCollection<CrmRecord>("records");
  return useMemo(() => {
    const byObject = new Map(objects.map((o) => [o.id, o]));
    const byId = new Map(records.map((r) => [r.id, r]));
    return (id: string) => {
      const r = byId.get(id);
      return r ? recordLabel(byObject.get(r.object), r) : undefined;
    };
  }, [objects, records]);
}

// Full-text index over records + activities, rebuilt when they change.
export function useSearchIndex(): CrmSearchIndex {
  const objects = useCollection<ObjectDef>("objects");
  const records = useCollection<CrmRecord>("records");
  const activities = useCollection<Activity>("activities");
  return useMemo(() => buildSearchIndex({ objects, records, activities }), [objects, records, activities]);
}

// ─── FieldValue / FieldInput bridge ─────────────────────────────────────

function FieldContextBridge({ children }: { children: ReactNode }) {
  const labelOf = useRecordLabel();
  const users = useUsers({ includeDisabled: true });
  const settings = useSettings();
  const records = useCollection<CrmRecord>("records");
  const objects = useCollection<ObjectDef>("objects");
  const value = useMemo<FieldContextValue>(() => {
    const byObject = new Map(objects.map((o) => [o.id, o]));
    return {
      locale: intlLocale(),
      currency: settings.defaultCurrency,
      users,
      recordLabel: labelOf,
      recordHref,
      searchRecords(object, query, limit = 20) {
        const q = query.trim().toLowerCase();
        const o = byObject.get(object);
        const out: { id: string; label: string; sub?: string }[] = [];
        for (const r of records) {
          if (r.object !== object || r.deletedAt) continue;
          const label = recordLabel(o, r);
          const sub = typeof r.fields.email === "string" ? r.fields.email : typeof r.fields.domain === "string" ? r.fields.domain.replace(/^https?:\/\//, "") : undefined;
          if (q && !label.toLowerCase().includes(q) && !(sub ?? "").toLowerCase().includes(q)) continue;
          out.push({ id: r.id, label, sub });
          if (out.length >= limit) break;
        }
        return out.sort((a, b) => a.label.localeCompare(b.label));
      },
    };
  }, [labelOf, users, settings.defaultCurrency, records, objects]);
  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}
