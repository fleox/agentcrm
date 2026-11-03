import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ListChecks, Trash2, Zap } from "lucide-react";
import { useAutomationRuns, useAutomations, useCan, useObjects, useOps, useRecordLabel } from "../../app/CrmDataContext";
import { paths } from "../../app/paths";
import { Badge, Button, confirmDialog, EmptyState, IconButton, PageHeader, Select, Table, TBody, Td, Th, THead, Tr } from "../../components/ui";
import { intlLocale } from "../../i18n";
import type { AutomationRunDoc } from "../../ops/automations";
import { clearAutomationRuns } from "../../ops/automations";
import { toast } from "../../shared/lib/toast";
import { formatDateTime } from "../../shared/lib/utils";
import { AutomationsTabs } from "./AutomationsTabs";
import { statusColor } from "./labels";

const PAGE = 100;

export function RunLogPage() {
  const { t } = useTranslation("automations");
  const ops = useOps();
  const [search, setSearch] = useSearchParams();
  const runs = useAutomationRuns() as AutomationRunDoc[];
  const automations = useAutomations();
  const objects = useObjects();
  const recordLabel = useRecordLabel();
  const canWrite = useCan("automations.write");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const automationFilter = search.get("automation") ?? "";
  const statusFilter = search.get("status") ?? "";
  const filtered = runs
    .filter((r) => (!automationFilter || r.automationId === automationFilter) && (!statusFilter || r.status === statusFilter))
    .sort((a, b) => b.startedAt - a.startedAt);
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };
  const recordObject = (id: string | undefined) => (id ? (ops.store.get("records", id) as { object?: string } | undefined)?.object : undefined);

  const clear = async () => {
    if (!(await confirmDialog({ title: t("runs.clearConfirm"), danger: true, confirmLabel: t("runs.clear") }))) return;
    const r = await clearAutomationRuns(ops, { automationId: automationFilter || undefined });
    toast.success(t("runs.cleared", { count: r.deleted }));
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        icon={<Zap />}
        description={t("subtitle")}
        actions={
          canWrite && runs.length > 0 ? (
            <Button icon={<Trash2 />} onClick={() => void clear()}>
              {t("runs.clear")}
            </Button>
          ) : undefined
        }
      />
      <AutomationsTabs value="runs" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-64"
            aria-label={t("runs.filterAutomation")}
            value={automationFilter}
            options={[{ value: "", label: t("runs.allAutomations") }, ...automations.map((a) => ({ value: a.id, label: a.name }))]}
            onChange={(e) => setFilter("automation", e.target.value)}
          />
          <Select
            className="w-44"
            aria-label={t("runs.filterStatus")}
            value={statusFilter}
            options={[{ value: "", label: t("runs.allStatuses") }, ...["ok", "error", "skipped"].map((s) => ({ value: s, label: t(`runs.statuses.${s}`) }))]}
            onChange={(e) => setFilter("status", e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState className="py-16" icon={<ListChecks />} title={t("runs.empty")} description={t("runs.emptyHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
            <Table>
              <THead>
                <Tr>
                  <Th className="w-8" />
                  <Th>{t("runs.when")}</Th>
                  <Th>{t("runs.automation")}</Th>
                  <Th>{t("runs.record")}</Th>
                  <Th>{t("runs.status")}</Th>
                  <Th>{t("runs.message")}</Th>
                </Tr>
              </THead>
              <TBody>
                {filtered.slice(0, limit).map((r) => {
                  const a = automations.find((x) => x.id === r.automationId);
                  const objectId = recordObject(r.recordId);
                  const expanded = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <Tr>
                        <Td>
                          <IconButton size="xs" label={t("runs.details")} icon={expanded ? <ChevronDown /> : <ChevronRight />} onClick={() => setOpen(expanded ? null : r.id)} />
                        </Td>
                        <Td className="whitespace-nowrap text-sm text-surface-600 dark:text-surface-300">{formatDateTime(r.startedAt, intlLocale())}</Td>
                        <Td className="text-sm">{a ? <Link className="hover:underline" to={`/automations/${a.id}`}>{a.name}</Link> : <span className="text-surface-400">{t("runs.deletedAutomation")}</span>}</Td>
                        <Td className="text-sm">
                          {r.recordId && objectId ? (
                            <Link className="hover:underline" to={paths.record(objectId, r.recordId)}>
                              {recordLabel(r.recordId) ?? r.recordId}
                            </Link>
                          ) : (
                            <span className="text-surface-400">{r.recordId ?? "—"}</span>
                          )}
                          {objectId && <span className="ml-1 text-xs text-surface-400">· {objects.find((o) => o.id === objectId)?.labelSingular}</span>}
                        </Td>
                        <Td>
                          <Badge color={statusColor(r.status)} dot>
                            {t(`runs.statuses.${r.status}`)}
                          </Badge>
                          {r.dryRun && <Badge className="ml-1">{t("runs.dryRun")}</Badge>}
                        </Td>
                        <Td className="max-w-md truncate text-sm text-surface-600 dark:text-surface-300" title={r.message}>
                          {r.message ?? t("runs.actionsDone", { count: r.actions?.length ?? 0 })}
                        </Td>
                      </Tr>
                      {expanded && (
                        <Tr>
                          <Td />
                          <Td colSpan={5}>
                            <ul className="space-y-1 py-1 text-sm">
                              {(r.actions ?? []).map((x, i) => (
                                <li key={i} className={x.ok ? "" : "text-red-600 dark:text-red-400"}>
                                  {x.ok ? "✓" : "✗"} {t(`actions.types.${x.type}`)}
                                  {x.message ? ` — ${x.message}` : ""}
                                </li>
                              ))}
                              {!r.actions?.length && <li className="text-surface-500">{r.message}</li>}
                              {r.trigger && <li className="text-xs text-surface-400">{t("runs.trigger", { trigger: t(`trigger.types.${r.trigger}`) })}</li>}
                            </ul>
                          </Td>
                        </Tr>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
        {filtered.length > limit && (
          <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
            {t("runs.more", { count: filtered.length - limit })}
          </Button>
        )}
      </div>
    </div>
  );
}
