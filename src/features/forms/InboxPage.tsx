import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Download, FileInput, Inbox, RefreshCw } from "lucide-react";
import { useCan, useForms, useOps } from "../../app/CrmDataContext";
import { paths } from "../../app/paths";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Switch, Table, TBody, Td, Th, THead, Tr } from "../../components/ui";
import { intlLocale } from "../../i18n";
import { ingestInbox, listInbox, type IngestReport, type InboxSubmission, type LeadFormDoc } from "../../ops/forms";
import { toast } from "../../shared/lib/toast";
import { formatDateTime } from "../../shared/lib/utils";
import { FormsTabs } from "./FormsTabs";
import { isAutoIngestOn, setAutoIngest } from "./FormsRuntime";

export function InboxPage() {
  const { t } = useTranslation("forms");
  const ops = useOps();
  const forms = useForms() as LeadFormDoc[];
  const canIngest = useCan("records.write");
  const [pending, setPending] = useState<InboxSubmission[] | null>(null);
  const [skipped, setSkipped] = useState<{ formId: string; reason: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [report, setReport] = useState<IngestReport | null>(null);
  const [auto, setAuto] = useState(isAutoIngestOn());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listInbox(ops);
      setPending(res.submissions);
      setSkipped(res.skippedForms);
    } catch (err) {
      setLoadError((err as Error).message);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [ops]);

  useEffect(() => {
    if (forms.length) void load();
    else setPending([]);
    // Reload when the set of forms changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms.length]);

  const ingest = async (dryRun = false) => {
    setIngesting(true);
    try {
      const r = await ingestInbox(ops, undefined, { dryRun });
      setReport(r);
      if (!dryRun) toast.success(t("inboxPage.done", { created: r.created, updated: r.updated, failed: r.failed }));
      if (!dryRun) await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  const formName = (id: string) => forms.find((f) => f.id === id)?.name ?? (id || t("inboxPage.unknownForm"));
  const preview = (s: InboxSubmission) =>
    Object.entries(s.data)
      .filter(([k]) => !k.startsWith("_"))
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join(" · ");

  return (
    <div>
      <PageHeader
        title={t("title")}
        icon={<FileInput />}
        description={t("subtitle")}
        actions={
          <>
            <Button icon={<RefreshCw />} loading={loading} onClick={() => void load()}>
              {t("inboxPage.refresh")}
            </Button>
            {canIngest && (
              <>
                <Button onClick={() => void ingest(true)} disabled={ingesting || !pending?.length}>
                  {t("inboxPage.dryRun")}
                </Button>
                <Button variant="primary" icon={<Download />} loading={ingesting} onClick={() => void ingest(false)}>
                  {t("inboxPage.ingestNow")}
                </Button>
              </>
            )}
          </>
        }
      />
      <FormsTabs value="inbox" />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Switch
            checked={auto}
            label={t("inboxPage.auto")}
            onChange={(v) => {
              setAuto(v);
              setAutoIngest(v);
            }}
          />
          <span className="text-xs text-surface-500">{t("inboxPage.autoHint")}</span>
        </div>

        {report && (
          <Card title={report.processed ? t("inboxPage.reportTitle") : t("inboxPage.reportEmpty")}>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge color="green">{t("inboxPage.created", { count: report.created })}</Badge>
              <Badge color="blue">{t("inboxPage.updated", { count: report.updated })}</Badge>
              <Badge color={report.failed ? "red" : "gray"}>{t("inboxPage.failed", { count: report.failed })}</Badge>
              <Badge>{t("inboxPage.spam", { count: report.spam ?? 0 })}</Badge>
              {!!report.companiesCreated && <Badge color="purple">{t("inboxPage.companies", { count: report.companiesCreated })}</Badge>}
            </div>
            {report.errors.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-red-600 dark:text-red-400">
                {report.errors.map((e) => (
                  <li key={e.submission}>
                    <code className="text-xs">{e.submission.split("/").pop()}</code> — {e.message}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {loadError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{loadError}</div>}

        {pending === null ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : pending.length === 0 ? (
          <EmptyState className="py-16" icon={<Inbox />} title={t("inboxPage.empty")} description={forms.length ? t("inboxPage.emptyHint") : t("emptyHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("inboxPage.received")}</Th>
                  <Th>{t("inboxPage.form")}</Th>
                  <Th>{t("inboxPage.data")}</Th>
                </Tr>
              </THead>
              <TBody>
                {pending.map((s) => (
                  <Tr key={s.id}>
                    <Td className="whitespace-nowrap text-sm text-surface-600 dark:text-surface-300">{s.createdAt ? formatDateTime(s.createdAt, intlLocale()) : "—"}</Td>
                    <Td className="text-sm">{formName(s.formId)}</Td>
                    <Td className="max-w-lg truncate text-sm text-surface-600 dark:text-surface-300">{s.meta?.invalid ? <Badge color="red">{t("inboxPage.invalid")}</Badge> : preview(s)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}

        {skipped.length > 0 && (
          <Card title={t("inboxPage.skippedTitle")}>
            <ul className="space-y-1 text-sm">
              {skipped.map((s) => (
                <li key={s.formId}>
                  <Link className="font-medium hover:underline" to={`/forms/${s.formId}`}>
                    {formName(s.formId)}
                  </Link>{" "}
                  <span className="text-surface-500">— {s.reason}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-surface-500">
              {t("inboxPage.skippedHint")}{" "}
              <Link className="underline" to={paths.settings()}>
                {t("inboxPage.settingsLink")}
              </Link>
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
