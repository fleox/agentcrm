import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowUpRight, Check, ExternalLink, Mail, PenLine, RefreshCw } from "lucide-react";
import { Badge, Button, EmptyState, Spinner } from "../../components/ui";
import { useCan, useCollection, useOps } from "../../app/CrmDataContext";
import type { RecordSlotProps } from "../types";
import { contactQuery, logEmail, loggedEmailIds, type EmailMessage } from "../../ops/integrations";
import { toast } from "../../shared/lib/toast";
import { needsInteraction } from "./auth";
import { ComposeModal } from "./ComposeModal";
import { ConnectPrompt } from "./ConnectPrompt";
import { formatDateTime, useIntegrations } from "./hooks";
import { searchRecordEmails, selfEmails } from "./service";

export function EmailsTab({ record }: RecordSlotProps) {
  const { t } = useTranslation("integrations");
  const ops = useOps();
  const canLog = useCan("activities.write");
  const { settings, connected } = useIntegrations();
  const activities = useCollection("activities");
  const logged = useMemo(() => loggedEmailIds(ops), [ops, activities]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = useMemo(() => contactQuery(ops, record), [ops, record]);
  const queryKey = `${query.emails.join(",")}|${query.domains.join(",")}`;
  const connectedKey = connected.join(",");
  const [messages, setMessages] = useState<EmailMessage[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const self = useMemo(() => new Set(selfEmails()), [connectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchRecordEmails(ops, record, settings);
      setMessages(res.messages);
      setErrors(res.errors.map((e) => `${t(`providers.${e.provider}`)}: ${e.message}`));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, record.id, queryKey, connectedKey, settings]);

  useEffect(() => {
    setMessages(null);
    setErrors([]);
    // Auto-load only when no popup would be needed (no user gesture here).
    if (connected.length && (query.emails.length || query.domains.length) && connected.every((p) => !needsInteraction(p))) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, queryKey, connectedKey]);

  if (!connected.length) return <ConnectPrompt />;
  if (!query.emails.length && !query.domains.length) {
    return <EmptyState icon={<Mail />} title={t("emails.noAddress")} description={t(record.object === "companies" ? "emails.noDomainHelp" : "emails.noAddressHelp")} />;
  }

  const logOne = async (m: EmailMessage) => {
    setLogging(m.id);
    try {
      const res = await logEmail(ops, m, { selfEmails: selfEmails(), targets: [{ object: record.object, id: record.id }] });
      toast.success(res.created ? t("emails.loggedToast") : t("emails.alreadyLogged"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLogging(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-surface-500">
          {query.emails.length ? t("emails.searching", { value: query.emails.join(", ") }) : t("emails.searchingDomain", { value: query.domains.join(", ") })}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={loading} onClick={() => void load()}>
            {messages ? t("emails.refresh") : t("emails.load")}
          </Button>
          <Button size="sm" variant="primary" icon={<PenLine />} onClick={() => setComposeOpen(true)}>
            {t("emails.compose")}
          </Button>
        </div>
      </div>
      {errors.map((e) => (
        <p key={e} className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {e}
        </p>
      ))}
      {loading && !messages ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : messages && !messages.length ? (
        <EmptyState icon={<Mail />} title={t("emails.empty")} />
      ) : messages ? (
        <ul className="divide-y divide-surface-100 rounded-lg border border-surface-200 dark:divide-surface-800 dark:border-surface-800">
          {messages.map((m) => {
            const isLogged = logged.has(`${m.provider}:${m.id}`);
            const outbound = !!m.from && self.has(m.from.email);
            return (
              <li key={`${m.provider}:${m.id}`} className="flex gap-3 px-3 py-2.5">
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 text-surface-400">{outbound ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium text-surface-900 dark:text-white">{m.subject || t("emails.noSubject")}</p>
                    <span className="shrink-0 text-xs text-surface-500">{formatDateTime(m.date)}</span>
                  </div>
                  <p className="truncate text-xs text-surface-500">
                    {t("emails.fromTo", { from: m.from?.name || m.from?.email || "?", to: m.to.map((a) => a.name || a.email).join(", ") || "—" })}
                  </p>
                  {m.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-surface-600 dark:text-surface-300">{m.snippet}</p>}
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge color={m.provider === "google" ? "red" : "blue"}>{t(`providers.${m.provider}`)}</Badge>
                    {isLogged ? (
                      <Badge color="green">
                        <span className="inline-flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          {t("emails.logged")}
                        </span>
                      </Badge>
                    ) : canLog ? (
                      <Button size="xs" variant="outline" loading={logging === m.id} onClick={() => void logOne(m)}>
                        {t("emails.log")}
                      </Button>
                    ) : null}
                    {m.url && (
                      <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">
                        <ExternalLink className="h-3 w-3" />
                        {t("emails.open")}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={<Mail />} title={t("emails.notLoaded")} action={<Button icon={<RefreshCw />} onClick={() => void load()}>{t("emails.load")}</Button>} />
      )}
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} record={record} defaults={{ to: query.emails[0] ?? "" }} />
    </div>
  );
}
