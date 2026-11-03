// Always mounted (globalOverlays): while the admin is open, one tab (the
// leader) runs the scheduled automations every few minutes. Event
// triggers are handled in-process by installAutomations() (index.ts).
import { useEffect, useRef } from "react";
import { useCan, useOps } from "../../app/CrmDataContext";
import { runScheduled } from "../../ops/automations";
import { runAsLeader } from "./leader";

export const SCHEDULE_TICK_MS = 5 * 60_000;

export function AutomationsRuntime() {
  const ops = useOps();
  const canRun = useCan("automations.run");
  const opsRef = useRef(ops);
  opsRef.current = ops;
  useEffect(() => {
    if (!canRun) return;
    return runAsLeader("automations", () => {
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          const hasScheduled = opsRef.current.store.list("automations").some((a) => a.enabled && (a.trigger as { type?: string })?.type && ["schedule", "inactivity"].includes((a.trigger as { type: string }).type));
          if (hasScheduled) await runScheduled(opsRef.current);
        } catch (err) {
          console.warn("[automations] scheduled run failed:", err);
        } finally {
          busy = false;
        }
      };
      const first = setTimeout(() => void tick(), 15_000);
      const timer = setInterval(() => void tick(), SCHEDULE_TICK_MS);
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    });
  }, [canRun]);
  return null;
}
