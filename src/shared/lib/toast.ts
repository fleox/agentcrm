// Module-level event bus for flash messages (toasts). Designed so any
// service — including code that has no business importing React — can
// trigger a UI notification without coupling to a context. The
// <ToastContainer> mounted in App subscribes once and renders the toasts.
//
// Why an emitter instead of a React context:
//   1. Services like siteFiles run outside the React tree (called from
//      handlers, effects, async chains). Threading a `showToast` callback
//      down to every call site is noisy and error-prone.
//   2. The emitter is trivially mockable in tests (no Provider required).
//   3. Multiple consumers can subscribe (e.g. a future devtools panel).

export type ToastLevel = "info" | "success" | "warn" | "error";

export interface ToastInput {
  level: ToastLevel;
  // Already-translated message. Services that emit toasts call i18n.t()
  // beforehand so the container only formats positions and visuals.
  message: string;
  // Lifetime in ms. Defaults to 6000 for errors, 3500 otherwise. Set to 0
  // to make the toast sticky — the user must dismiss it manually.
  durationMs?: number;
}

export interface Toast extends ToastInput {
  id: string;
  createdAt: number;
}

type Subscriber = (toast: Toast) => void;
const subscribers = new Set<Subscriber>();

function newToastId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function showToast(input: ToastInput): Toast {
  const toast: Toast = { ...input, id: newToastId(), createdAt: Date.now() };
  subscribers.forEach((fn) => {
    try {
      fn(toast);
    } catch (err) {
      // A subscriber blowing up should never prevent other subscribers
      // from receiving the event. Log and continue.
      console.error("Toast subscriber threw:", err);
    }
  });
  return toast;
}

// Shortcut helpers — keep call sites concise.
export const toast = {
  info: (message: string, durationMs?: number) => showToast({ level: "info", message, durationMs }),
  success: (message: string, durationMs?: number) =>
    showToast({ level: "success", message, durationMs }),
  warn: (message: string, durationMs?: number) => showToast({ level: "warn", message, durationMs }),
  error: (message: string, durationMs?: number) =>
    showToast({ level: "error", message, durationMs }),
};

export function subscribeToToasts(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Default lifetime per level. Errors stick around longer so the user has
// time to read them; transient confirmations dismiss quickly.
export function defaultDurationFor(level: ToastLevel): number {
  switch (level) {
    case "error":
      return 6000;
    case "warn":
      return 5000;
    default:
      return 3500;
  }
}
