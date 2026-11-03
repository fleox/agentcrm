import { useMemo } from "react";
import { useConfigDoc } from "../../app/CrmDataContext";
import { effectiveSettings, useIntegrationState, type SharedIntegrationConfig } from "./state";

// Integration state with client ids resolved (local, else team-shared).
export function useIntegrations() {
  const state = useIntegrationState();
  const shared = useConfigDoc<SharedIntegrationConfig>("integrations");
  const settings = useMemo(
    () => effectiveSettings(shared),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shared, state.version],
  );
  return { ...state, settings, shared };
}

export function formatDateTime(ms: number, locale?: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
