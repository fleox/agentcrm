import { useEffect } from "react";
import { useCan, useOps } from "../../app/CrmDataContext";
import { needsInteraction } from "./auth";
import { useIntegrations } from "./hooks";
import { syncAllMeetings } from "./service";
import { STORAGE_PREFIX } from "./state";

const LAST_SYNC_KEY = `${STORAGE_PREFIX}lastMeetingSync`;
const EVERY_MS = 30 * 60_000;

// Always-mounted: when "auto-sync meetings" is on and a provider is
// connected, sync meetings at most every 30 min (per tab session).
export function AutoSync() {
  const ops = useOps();
  const canWrite = useCan("activities.write");
  const { settings, connected } = useIntegrations();
  const key = connected.join(",");
  useEffect(() => {
    if (!settings.autoSyncMeetings || !canWrite || !connected.length) return;
    let stopped = false;
    const tick = async () => {
      const ready = connected.filter((p) => !needsInteraction(p));
      if (!ready.length) return;
      let last = 0;
      try {
        last = Number(window.sessionStorage.getItem(LAST_SYNC_KEY) || 0);
      } catch {
        last = 0;
      }
      if (Date.now() - last < EVERY_MS) return;
      try {
        window.sessionStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      if (!stopped) await syncAllMeetings(ops, settings, { providers: ready }).catch(() => undefined);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5 * 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoSyncMeetings, canWrite, key, ops]);
  return null;
}
