// Always mounted (globalOverlays): while the admin is open, the leader
// tab ingests the lead inboxes every few minutes (toggle per browser on
// the Inbox page).
import { useEffect, useRef } from "react";
import { useCan, useOps } from "../../app/CrmDataContext";
import { ingestInbox } from "../../ops/forms";
import { runAsLeader } from "../automations/leader";

export const INGEST_TICK_MS = 5 * 60_000;
const AUTO_KEY = "agentcrm.forms.autoIngest";

export function isAutoIngestOn(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoIngest(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
}

export function FormsRuntime() {
  const ops = useOps();
  const canWrite = useCan("records.write");
  const opsRef = useRef(ops);
  opsRef.current = ops;
  useEffect(() => {
    if (!canWrite) return;
    return runAsLeader("forms-ingest", () => {
      let busy = false;
      const tick = async () => {
        if (busy || !isAutoIngestOn()) return;
        const forms = opsRef.current.store.list("forms") as unknown as { inbox?: { kind?: string } }[];
        if (!forms.some((f) => f.inbox?.kind && f.inbox.kind !== "webhook")) return;
        busy = true;
        try {
          const r = await ingestInbox(opsRef.current);
          if (r.processed) console.info(`[forms] ingested ${r.processed} submission(s): ${r.created} created, ${r.updated} updated, ${r.failed} failed.`);
        } catch (err) {
          console.warn("[forms] inbox ingestion failed:", err);
        } finally {
          busy = false;
        }
      };
      const first = setTimeout(() => void tick(), 20_000);
      const timer = setInterval(() => void tick(), INGEST_TICK_MS);
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    });
  }, [canWrite]);
  return null;
}
