import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { defaultDurationFor, subscribeToToasts, type Toast } from "../../shared/lib/toast";
import { cn } from "../../shared/lib/utils";
import { Portal } from "./Overlay";

const ICONS = {
  info: <Info className="h-4 w-4 text-blue-500" />,
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
};

// Renders toasts emitted anywhere with shared/lib/toast.ts. Mount once.
export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(
    () =>
      subscribeToToasts((t) => {
        setToasts((list) => [...list.slice(-4), t]);
        const ms = t.durationMs ?? defaultDurationFor(t.level);
        if (ms > 0) setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), ms);
      }),
    [],
  );
  if (!toasts.length) return null;
  return (
    <Portal>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex animate-scale-in items-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 text-sm shadow-pop dark:bg-surface-900",
              t.level === "error" ? "border-red-200 dark:border-red-500/30" : "border-surface-200 dark:border-surface-700",
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.level]}</span>
            <p className="min-w-0 flex-1 break-words text-surface-800 dark:text-surface-100">{t.message}</p>
            <button type="button" aria-label="Dismiss" className="shrink-0 text-surface-400 hover:text-surface-700" onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Portal>
  );
}
