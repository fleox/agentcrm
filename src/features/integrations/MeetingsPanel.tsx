import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, MapPin, RefreshCw } from "lucide-react";
import { Button, Card } from "../../components/ui";
import { useCan, useCollection, useOps, useRecords } from "../../app/CrmDataContext";
import { recordHref } from "../../app/paths";
import { normalizeEmail } from "../../core/fields";
import type { RecordSlotProps } from "../types";
import { upcomingMeetings } from "../../ops/integrations";
import { toast } from "../../shared/lib/toast";
import { ConnectPrompt } from "./ConnectPrompt";
import { formatDateTime, useIntegrations } from "./hooks";
import { syncAllMeetings } from "./service";

export function MeetingsPanel({ record }: RecordSlotProps) {
  const { t } = useTranslation("integrations");
  const ops = useOps();
  const canWrite = useCan("activities.write");
  const { settings, connected } = useIntegrations();
  const activities = useCollection("activities");
  const people = useRecords("people");
  const [syncing, setSyncing] = useState(false);
  const meetings = useMemo(() => upcomingMeetings(ops, record.id, { limit: 5 }), [ops, record.id, activities]); // eslint-disable-line react-hooks/exhaustive-deps
  const byEmail = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const p of people) {
      const e = normalizeEmail(p.fields.email);
      if (e) m.set(e, { id: p.id, name: String(p.fields.name || e) });
    }
    return m;
  }, [people]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncAllMeetings(ops, settings);
      if (r.errors.length) toast.error(r.errors.join("\n"));
      else toast.success(t("meetings.synced", { created: r.created.length, updated: r.updated.length }));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card
      title={t("meetings.title")}
      actions={
        connected.length && canWrite ? (
          <Button size="xs" variant="ghost" icon={<RefreshCw />} loading={syncing} onClick={() => void sync()}>
            {t("meetings.sync")}
          </Button>
        ) : undefined
      }
    >
      {meetings.length ? (
        <ul className="space-y-3">
          {meetings.map((a) => {
            const attendees = ((a.meta?.attendees as string[] | undefined) ?? []).map((e) => byEmail.get(normalizeEmail(e))).filter((x): x is { id: string; name: string } => !!x);
            return (
              <li key={a.id} className="text-sm">
                <p className="font-medium text-surface-900 dark:text-white">{a.title}</p>
                <p className="flex items-center gap-1 text-xs text-surface-500">
                  <CalendarClock className="h-3 w-3" />
                  {formatDateTime(a.meta?.startAt as number)}
                </p>
                {typeof a.meta?.location === "string" && a.meta.location && (
                  <p className="flex items-center gap-1 truncate text-xs text-surface-500">
                    <MapPin className="h-3 w-3" />
                    {a.meta.location}
                  </p>
                )}
                {attendees.length > 0 && (
                  <p className="mt-0.5 truncate text-xs">
                    {attendees.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <a href={recordHref("people", p.id)} className="text-accent-600 hover:underline dark:text-accent-400">
                          {p.name}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-surface-500">{t("meetings.empty")}</p>
      )}
      {!connected.length && (
        <div className="mt-3 border-t border-surface-100 pt-3 dark:border-surface-800">
          <ConnectPrompt compact />
        </div>
      )}
    </Card>
  );
}
