// The connectors, git layer and document stores under src/ were written
// for the browser. They only need `window` + `localStorage` from it (and
// guard IndexedDB), so a tiny in-memory stand-in lets the CLI reuse them
// unchanged. The storage lives for one command: secrets seeded into it
// are never written to disk by this shim.
//
// Must run BEFORE any src/ module is imported (commands import them
// dynamically after calling installBrowserEnv()).

class MemoryStorage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

let installed = false;

export function installBrowserEnv(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  for (const name of ["localStorage", "sessionStorage"]) {
    // Recent Node versions ship a (file-backed, warning) localStorage —
    // replace it so nothing is ever persisted.
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
  }
  if (typeof g.window === "undefined") {
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true, writable: true });
  }
}
