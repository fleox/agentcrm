// Leader election across the admin tabs of this browser, so background
// jobs (scheduled automations, lead inbox ingestion) run in ONE tab only.
//
// Uses the Web Locks API when available (the lock holder is the leader;
// the lock is released automatically when the tab closes). Fallback: a
// localStorage heartbeat lease (`agentcrm.leader.<name>`), renewed every
// LEASE_MS / 3 and announced on a BroadcastChannel so a follower takes
// over as soon as the leader leaves.
//
// runAsLeader(name, start) calls start() once this tab becomes the
// leader; start returns its own stop function. The returned function
// stops everything (and releases the lock / lease).

const LEASE_MS = 30_000;

function tabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function runAsLeader(name: string, start: () => () => void): () => void {
  let stopJob: (() => void) | null = null;
  let stopped = false;
  const become = () => {
    if (stopped || stopJob) return;
    stopJob = start();
  };
  const resign = () => {
    stopJob?.();
    stopJob = null;
  };

  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) {
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => (release = resolve));
    locks
      .request(`agentcrm:${name}`, { mode: "exclusive" }, async () => {
        if (stopped) return;
        become();
        await held;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      resign();
      release?.();
    };
  }

  // Fallback: localStorage lease.
  const key = `agentcrm.leader.${name}`;
  const me = tabId();
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`agentcrm-leader-${name}`) : null;
  const read = (): { id: string; at: number } | null => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
    } catch {
      return null;
    }
  };
  const write = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ id: me, at: Date.now() }));
    } catch {
      // Storage blocked: run anyway (single tab is the common case).
    }
  };
  const tick = () => {
    if (stopped) return;
    const lease = read();
    if (!lease || lease.id === me || Date.now() - lease.at > LEASE_MS) {
      write();
      // Re-read: another tab may have written at the same time.
      if (read()?.id === me || !read()) become();
      else resign();
    } else resign();
  };
  tick();
  const timer = setInterval(tick, LEASE_MS / 3);
  if (channel) channel.onmessage = (e) => e.data === "released" && tick();
  const onUnload = () => stop();
  if (typeof window !== "undefined") window.addEventListener("pagehide", onUnload);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    resign();
    if (read()?.id === me) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      channel?.postMessage("released");
    }
    channel?.close();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onUnload);
  }
  return stop;
}
