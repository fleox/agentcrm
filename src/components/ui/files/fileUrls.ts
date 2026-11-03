// Blob URL cache for stored files: one object URL per (dataset, file,
// thumb) shared by every component showing it, revoked a little after the
// last user unmounts (so lists / lightboxes re-mounting don't refetch).

import { useEffect, useState } from "react";
import { useFilesBridge, type FilesBridge } from "./context";

interface Entry {
  url?: string;
  promise: Promise<string>;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
}

const cache = new Map<string, Entry>();
const REVOKE_DELAY_MS = 60_000;

function keyOf(bridge: FilesBridge, id: string, thumb: boolean): string {
  return `${bridge.key}|${id}|${thumb ? "t" : "o"}`;
}

export function acquire(bridge: FilesBridge, id: string, thumb: boolean): Entry {
  const key = keyOf(bridge, id, thumb);
  let e = cache.get(key);
  if (!e) {
    const entry: Entry = { refs: 0, promise: Promise.resolve("") };
    entry.promise = bridge.load(id, { thumb }).then((blob) => {
      entry.url = URL.createObjectURL(blob);
      return entry.url;
    });
    entry.promise.catch(() => cache.delete(key));
    cache.set(key, entry);
    e = entry;
  }
  if (e.timer) {
    clearTimeout(e.timer);
    e.timer = undefined;
  }
  e.refs++;
  return e;
}

export function release(bridge: FilesBridge, id: string, thumb: boolean): void {
  const key = keyOf(bridge, id, thumb);
  const e = cache.get(key);
  if (!e) return;
  e.refs--;
  if (e.refs > 0) return;
  e.timer = setTimeout(() => {
    if (e.refs > 0) return;
    cache.delete(key);
    if (e.url) URL.revokeObjectURL(e.url);
  }, REVOKE_DELAY_MS);
}

// Object URL of a file, for one-off use (open in a new tab, download).
// The caller revokes it.
export async function fileObjectUrl(bridge: FilesBridge, id: string): Promise<string> {
  return URL.createObjectURL(await bridge.load(id));
}

export function revokeAllFileUrls(): void {
  for (const e of cache.values()) if (e.url) URL.revokeObjectURL(e.url);
  cache.clear();
}

export interface FileUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

// Blob URL of a stored file (or its thumbnail), with loading / error states.
export function useFileUrl(id: string | null | undefined, opts: { thumb?: boolean } = {}): FileUrlState {
  const bridge = useFilesBridge();
  const thumb = !!opts.thumb;
  const [state, setState] = useState<FileUrlState>({ url: null, loading: !!id, error: null });
  useEffect(() => {
    if (!id || !bridge) {
      setState({ url: null, loading: false, error: id ? "unavailable" : null });
      return;
    }
    let alive = true;
    const e = acquire(bridge, id, thumb);
    if (e.url) setState({ url: e.url, loading: false, error: null });
    else {
      setState({ url: null, loading: true, error: null });
      e.promise.then(
        (url) => alive && setState({ url, loading: false, error: null }),
        (err: unknown) => alive && setState({ url: null, loading: false, error: err instanceof Error ? err.message : String(err) }),
      );
    }
    return () => {
      alive = false;
      release(bridge, id, thumb);
    };
  }, [bridge, id, thumb]);
  return state;
}
