import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultViewFor } from "../../../core/schema/standardObjects";
import type { ObjectDef, ViewDef, ViewPrefs } from "../../../core/types";
import { useRecordLabel, useUsers } from "../../../app/CrmDataContext";
import { toast } from "../../../shared/lib/toast";
import { viewSignature } from "./viewModel";
import { applyViewPrefs, layoutOverrides } from "./userPrefs";

// Query context for core/query (labels of related records, user names).
export function useQueryCtx() {
  const labelOf = useRecordLabel();
  const users = useUsers({ includeDisabled: true });
  return useMemo(() => {
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { now: Date.now(), recordLabel: (_o: string, id: string) => labelOf(id), userName: (id: string) => names.get(id) };
  }, [labelOf, users]);
}

export interface ViewDraft {
  // The saved view (undefined = synthesized default, never saved).
  saved: ViewDef | undefined;
  draft: ViewDef;
  dirty: boolean;
  set(patch: Partial<ViewDef>): void;
  reset(): void;
}

// The user's remembered layout of one view (see ./userPrefs).
export interface ViewLayoutStore {
  get(viewId: string): ViewPrefs | undefined;
  put(viewId: string, value: ViewPrefs): void;
}

// Editable copy of the current view; `dirty` once it differs from the
// saved one. Starts from the saved view with the user's remembered layout
// on top, and remembers every change (`layouts`), so a reload or another
// device shows the list as the user left it. Re-derived when the saved
// view changes (switch / save / remote) or the layout is changed on
// another device.
export function useViewDraft(object: ObjectDef | undefined, saved: ViewDef | undefined, layouts?: ViewLayoutStore): ViewDraft {
  const base = useMemo<ViewDef | undefined>(() => saved ?? (object ? defaultViewFor(object) : undefined), [saved, object]);
  const stored = base ? layouts?.get(base.id) : undefined;
  const start = useMemo(() => (base && object ? applyViewPrefs(base, object, stored) : base), [base, object, stored]);
  const [draft, setDraft] = useState<ViewDef | undefined>(start);
  const baseSig = base ? viewSignature(base) : "";
  // Layout copies written from here: their echo is not re-applied.
  const mine = useRef<number[]>([]);
  const seen = useRef<{ id?: string; baseSig: string; at?: number }>({ id: base?.id, baseSig, at: stored?.at });
  useEffect(() => {
    const at = stored?.at;
    const prev = seen.current;
    seen.current = { id: base?.id, baseSig, at };
    const elsewhere = at !== prev.at && !(at !== undefined && mine.current.includes(at));
    if (prev.id !== base?.id || prev.baseSig !== baseSig || elsewhere) setDraft(start);
  }, [base?.id, baseSig, stored?.at, start]);
  const current = draft && draft.id === base?.id ? draft : start;
  const currentRef = useRef(current);
  currentRef.current = current;

  const remember = useCallback(
    (next: ViewDef | undefined) => {
      if (!layouts || !base || !next) return;
      const at = Date.now();
      mine.current = [...mine.current.slice(-20), at];
      const widths = layouts.get(base.id)?.widths;
      layouts.put(base.id, { ...layoutOverrides(next, base), ...(widths ? { widths } : {}), at } as ViewPrefs);
    },
    [layouts, base],
  );
  const set = useCallback(
    (patch: Partial<ViewDef>) => {
      const next = currentRef.current ? { ...currentRef.current, ...patch } : currentRef.current;
      setDraft(next);
      remember(next);
    },
    [remember],
  );
  const reset = useCallback(() => {
    setDraft(base);
    remember(base);
  }, [base, remember]);
  return {
    saved,
    draft: current as ViewDef,
    dirty: !!current && !!base && viewSignature(current) !== baseSig,
    set,
    reset,
  };
}

// Runs an op, toasts its error. Returns the result or undefined.
export function useRun() {
  const { t } = useTranslation("records");
  return useCallback(
    async <T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const out = await fn();
        if (success) toast.success(success);
        return out;
      } catch (err) {
        toast.error((err as Error).message || t("errors.generic"));
        return undefined;
      }
    },
    [t],
  );
}

// Per-browser persisted state (column widths, kanban order…).
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const read = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [value, setValue] = useState<T>(read);
  useEffect(() => setValue(read()), [read]);
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Not persisted.
        }
        return next;
      });
    },
    [key],
  );
  return [value, set];
}
