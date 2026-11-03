// Danger zone (admins): compact storage (purges items deleted more than
// COMPACT_DAYS ago; dry run report → confirm), purge
// every soft-deleted record now, load the demo dataset.

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Database, Eraser, FlaskConical, Sparkles } from "lucide-react";
import { Button, Card, confirmDialog } from "../../../components/ui";
import { useCan, useCurrentUser, useOps, useSettings } from "../../../app/CrmDataContext";
import { compactData, type CompactReport } from "../../../ops/compact";
import { seedDemoData } from "../../../ops/seed";
import { toast } from "../../../shared/lib/toast";
import { ReadOnlyNote, SectionHeader, StatTile, errorMessage } from "../components/common";

const COMPACT_DAYS = 30;

function Row({ icon, title, description, children }: { icon: ReactNode; title: ReactNode; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-surface-100 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center dark:border-surface-800">
      <span className="hidden text-surface-400 sm:block [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-surface-900 dark:text-white">{title}</div>
        <div className="text-xs text-surface-500">{description}</div>
      </div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </div>
  );
}

export function DangerZoneSection() {
  const { t } = useTranslation("settings");
  const ops = useOps();
  const me = useCurrentUser();
  const settings = useSettings();
  const canCompact = useCan("compact");
  const canWriteRecords = useCan("records.write");
  const canWriteSettings = useCan("settings.write");
  const canSeed = canWriteRecords && canWriteSettings;
  const [report, setReport] = useState<CompactReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!canCompact) {
    return (
      <div className="max-w-3xl">
        <SectionHeader title={t("danger.title")} description={t("danger.description")} />
        <ReadOnlyNote>{t("danger.adminOnly")}</ReadOnlyNote>
      </div>
    );
  }

  const preview = async () => {
    setBusy("preview");
    try {
      setReport(await compactData(ops, { dryRun: true, olderThanDays: COMPACT_DAYS }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const compact = async (purgeAll: boolean) => {
    const olderThanDays = purgeAll ? 0 : COMPACT_DAYS;
    let dry: CompactReport;
    try {
      dry = await compactData(ops, { dryRun: true, olderThanDays });
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
    setReport(dry);
    const ok = await confirmDialog({
      title: purgeAll ? t("danger.purgeConfirmTitle") : t("danger.compactConfirmTitle"),
      description: t("danger.compactConfirm", { records: dry.purgedRecords.length, activities: dry.purgedActivities, runs: dry.purgedRuns }),
      confirmLabel: purgeAll ? t("danger.purge") : t("danger.compact"),
      danger: true,
    });
    if (!ok) return;
    setBusy(purgeAll ? "purge" : "compact");
    try {
      const r = await compactData(ops, { olderThanDays });
      setReport(r);
      toast.success(t("danger.compacted", { records: r.purgedRecords.length, activities: r.purgedActivities }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    const ok = await confirmDialog({ title: t("danger.demoConfirmTitle"), description: t("danger.demoConfirm"), confirmLabel: t("danger.loadDemo"), danger: true });
    if (!ok) return;
    setBusy("demo");
    try {
      const r = await seedDemoData(ops, { ownerId: me.id, currency: settings.defaultCurrency });
      if (!r.companies && !r.people && !r.deals) toast.info(t("danger.demoAlready"));
      else toast.success(t("danger.demoLoaded", { companies: r.companies, people: r.people, deals: r.deals }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <SectionHeader title={t("danger.title")} description={t("danger.description")} />
      <div className="overflow-hidden rounded-lg border border-red-200 bg-white dark:border-red-500/30 dark:bg-surface-900">
        <Row icon={<Archive />} title={t("danger.compactTitle")} description={t("danger.compactHelp", { days: COMPACT_DAYS })}>
          <Button size="sm" icon={<FlaskConical />} loading={busy === "preview"} onClick={() => void preview()}>
            {t("danger.preview")}
          </Button>
          <Button size="sm" variant="danger" icon={<Database />} loading={busy === "compact"} onClick={() => void compact(false)}>
            {t("danger.compact")}
          </Button>
        </Row>
        <Row icon={<Eraser />} title={t("danger.purgeTitle")} description={t("danger.purgeHelp")}>
          <Button size="sm" variant="danger" icon={<Eraser />} loading={busy === "purge"} onClick={() => void compact(true)}>
            {t("danger.purge")}
          </Button>
        </Row>
        {canSeed && (
          <Row icon={<Sparkles />} title={t("danger.demoTitle")} description={t("danger.demoHelp")}>
            <Button size="sm" variant="danger" icon={<Sparkles />} loading={busy === "demo"} onClick={() => void demo()}>
              {t("danger.loadDemo")}
            </Button>
          </Row>
        )}
      </div>
      {report && (
        <Card title={report.dryRun ? t("danger.reportDry") : t("danger.reportDone")} data-testid="compact-report">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label={t("danger.records")} value={report.purgedRecords.length} />
            <StatTile label={t("danger.activities")} value={report.purgedActivities} />
            <StatTile label={t("danger.runs")} value={report.purgedRuns} />
            <StatTile label={t("danger.storage")} value={report.dryRun ? "—" : report.storageCompacted ? t("danger.yes") : t("danger.notSupported")} />
          </div>
        </Card>
      )}
    </div>
  );
}
