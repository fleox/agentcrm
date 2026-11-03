// Tiny event bus between the shell and features (no shared state).
//   "search.open"     top bar search / Cmd+K → the search feature's palette
//   "assistant.toggle" → the assistant panel
//   "record.create"    { object } → quick-create modal (records feature)
// Features may define their own "<feature>.<event>" names.

import { useEffect, useRef } from "react";

export type ShellEventName = "search.open" | "assistant.toggle" | "record.create" | (string & {});

const target: EventTarget | null = typeof EventTarget !== "undefined" ? new EventTarget() : null;

export function emitShellEvent(name: ShellEventName, detail?: unknown): void {
  target?.dispatchEvent(new CustomEvent(name, { detail }));
}

export function onShellEvent(name: ShellEventName, handler: (detail: unknown) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  target?.addEventListener(name, listener);
  return () => target?.removeEventListener(name, listener);
}

export function useShellEvent(name: ShellEventName, handler: (detail: unknown) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onShellEvent(name, (d) => ref.current(d)), [name]);
}
