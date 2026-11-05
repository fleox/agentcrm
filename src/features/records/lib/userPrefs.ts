// Per-user interface preferences (users/<id>.prefs): each view's layout as
// the user left it (filters, sorts, columns, widths…) and the last view
// opened per object, so the list looks the same after a reload or on
// another device.
//
// Read: the newest of the CRM copy and this browser's copy, per view.
// Write: this browser at once (localStorage), the CRM debounced. Backends
// where a write is costly (git-json: one commit each) or refused (Firestore
// rules not yet republished) keep the browser copy only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FILTER_OPS, type Filter, type ObjectDef, type UserPrefs, type ViewDef, type ViewPrefs } from "../../../core/types";
import { resolveField } from "../../../core/query";
import type { CrmUser } from "../../../core/types";
import { useCrm, useDoc } from "../../../app/CrmDataContext";
import { setUserPrefs, type UserPrefsPatch } from "../../../ops/users";

const DEBOUNCE_MS = 800;
const LAYOUT_KEYS = ["type", "columns", "filters", "sorts", "groupBy", "pipelineId"] as const;
type LayoutKey = (typeof LAYOUT_KEYS)[number];
const RECORD_PROPS = ["id", "createdBy"];

const storageKey = (userId: string) => `agentcrm.prefs.${userId}`;

function readLocal(userId: string): UserPrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as UserPrefs) : {};
  } catch {
    return {};
  }
}

function writeLocal(userId: string, prefs: UserPrefs): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // Not persisted in this browser.
  }
}

function newest<T extends { at: number }>(a: Record<string, T> = {}, b: Record<string, T> = {}): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || (v?.at ?? 0) > (out[k]?.at ?? 0)) out[k] = v;
  return out;
}

// Per view / per object, the most recently written copy wins.
export function mergePrefs(a: UserPrefs | undefined, b: UserPrefs | undefined): UserPrefs {
  return { views: newest(a?.views, b?.views), lastView: newest(a?.lastView, b?.lastView) };
}

export function applyPrefsPatch(prefs: UserPrefs, patch: UserPrefsPatch): UserPrefs {
  const views = { ...(prefs.views ?? {}) };
  for (const [id, v] of Object.entries(patch.views ?? {})) {
    if (v) views[id] = v;
    else delete views[id];
  }
  return { views, lastView: { ...(prefs.lastView ?? {}), ...(patch.lastView ?? {}) } };
}

export interface PrefsApi {
  prefs: UserPrefs;
  update(patch: UserPrefsPatch): void;
}

export function useUserPrefs(): PrefsApi {
  const { user, ops, store } = useCrm();
  const doc = useDoc<CrmUser>("users", user.id);
  const [local, setLocal] = useState<UserPrefs>(() => readLocal(user.id));
  useEffect(() => setLocal(readLocal(user.id)), [user.id]);
  const prefs = useMemo(() => mergePrefs(doc?.prefs, local), [doc?.prefs, local]);

  const remote = !!doc && store.kind !== "git-json";
  const pending = useRef<UserPrefsPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refused = useRef(false);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (!remote || refused.current || (!Object.keys(patch.views ?? {}).length && !Object.keys(patch.lastView ?? {}).length)) return;
    setUserPrefs(ops, patch).catch(() => {
      // Refused (rules) or offline: this browser's copy still holds it.
      refused.current = true;
    });
  }, [ops, remote]);

  const update = useCallback(
    (patch: UserPrefsPatch) => {
      setLocal((prev) => {
        const next = applyPrefsPatch(prev, patch);
        writeLocal(user.id, next);
        return next;
      });
      pending.current = {
        views: { ...(pending.current.views ?? {}), ...(patch.views ?? {}) },
        lastView: { ...(pending.current.lastView ?? {}), ...(patch.lastView ?? {}) },
      };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [user.id, flush],
  );
  // Leaving the page writes what is still waiting.
  useEffect(() => () => flush(), [flush]);
  return { prefs, update };
}

// ─── View layouts ───────────────────────────────────────────────────────

function knownField(object: ObjectDef, id: string): boolean {
  return !!resolveField(object, id) || RECORD_PROPS.includes(id);
}

// The saved view with the user's layout on top; whatever no longer exists
// (a deleted field, an unknown operator) is dropped.
export function applyViewPrefs(base: ViewDef, object: ObjectDef, p: ViewPrefs | undefined): ViewDef {
  if (!p) return base;
  const out: ViewDef = { ...base };
  if (p.type === "table" || p.type === "kanban") out.type = p.type;
  if (Array.isArray(p.columns)) out.columns = p.columns.filter((c) => typeof c === "string" && knownField(object, c));
  if (Array.isArray(p.filters)) out.filters = p.filters.filter((f: Filter) => !!f && FILTER_OPS.includes(f.op) && knownField(object, f.field));
  if (Array.isArray(p.sorts)) out.sorts = p.sorts.filter((s) => !!s && knownField(object, s.field) && (s.dir === "asc" || s.dir === "desc"));
  if ("groupBy" in p) out.groupBy = p.groupBy ?? undefined;
  if ("pipelineId" in p) out.pipelineId = p.pipelineId ?? undefined;
  if (out.type === "kanban") {
    const group = object.fields.find((f) => f.id === out.groupBy);
    if (!group || !["select", "user", "boolean"].includes(group.type)) {
      out.type = base.type;
      out.groupBy = base.groupBy;
      out.pipelineId = base.pipelineId;
    }
  }
  return out;
}

// What differs from the saved view (the part worth remembering).
export function layoutOverrides(draft: ViewDef, base: ViewDef): Partial<Record<LayoutKey, unknown>> {
  const out: Partial<Record<LayoutKey, unknown>> = {};
  for (const k of LAYOUT_KEYS) {
    const a = draft[k] ?? null;
    const b = base[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = a;
  }
  return out;
}
