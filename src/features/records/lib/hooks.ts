import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultViewFor } from "../../../core/schema/standardObjects";
import type { ObjectDef, ViewDef } from "../../../core/types";
import { useRecordLabel, useUsers } from "../../../app/CrmDataContext";
import { toast } from "../../../shared/lib/toast";
import { viewSignature } from "./viewModel";

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

// Editable copy of the current view; `dirty` once it differs from the
// saved one. Resets when the saved view changes (switch / save / remote).
export function useViewDraft(object: ObjectDef | undefined, saved: ViewDef | undefined): ViewDraft {
  const base = useMemo<ViewDef | undefined>(() => saved ?? (object ? defaultViewFor(object) : undefined), [saved, object]);
  const [draft, setDraft] = useState<ViewDef | undefined>(base);
  const baseSig = base ? viewSignature(base) : "";
  const lastBase = useRef<{ id?: string; sig: string }>({ id: base?.id, sig: baseSig });
  useEffect(() => {
    if (lastBase.current.id !== base?.id || lastBase.current.sig !== baseSig) {
      lastBase.current = { id: base?.id, sig: baseSig };
      setDraft(base);
    }
  }, [base, baseSig]);
  const current = draft && draft.id === base?.id ? draft : base;
  const set = useCallback((patch: Partial<ViewDef>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);
  const reset = useCallback(() => setDraft(base), [base]);
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
