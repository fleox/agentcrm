import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Copy, LayoutTemplate, MoreHorizontal, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { useAutomationRuns, useAutomations, useCan, useObjects, useOps, usePipelines, useUsers } from "../../app/CrmDataContext";
import { Badge, Button, confirmDialog, Dropdown, EmptyState, IconButton, PageHeader, Switch, Table, TBody, Td, Th, THead, Tr } from "../../components/ui";
import { intlLocale } from "../../i18n";
import { deleteAutomation, duplicateAutomation, runScheduled, setAutomationEnabled } from "../../ops/automations";
import { toast } from "../../shared/lib/toast";
import { formatRelative } from "../../shared/lib/utils";
import { AutomationsTabs } from "./AutomationsTabs";
import { statusColor, useAutomationLabels } from "./labels";

export function AutomationsPage() {
  const { t } = useTranslation("automations");
  const ops = useOps();
  const navigate = useNavigate();
  const automations = useAutomations();
  const runs = useAutomationRuns();
  const objects = useObjects();
  const pipelines = usePipelines();
  const users = useUsers();
  const canWrite = useCan("automations.write");
  const canRun = useCan("automations.run");
  const { triggerSummary } = useAutomationLabels(objects, pipelines, users);
  const [running, setRunning] = useState(false);

  const lastRun = (id: string) => runs.filter((r) => r.automationId === id).sort((a, b) => b.startedAt - a.startedAt)[0];
  const sorted = [...automations].sort((a, b) => a.name.localeCompare(b.name));

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await runScheduled(ops, { force: false });
      toast.success(t("list.runNowDone", { ran: r.ran, errors: r.errors }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: t("list.deleteConfirm", { name }), description: t("list.deleteConfirmBody"), danger: true, confirmLabel: t("list.delete") }))) return;
    try {
      await deleteAutomation(ops, id);
      toast.success(t("list.deleted"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        icon={<Zap />}
        description={t("subtitle")}
        actions={
          <>
            {canRun && (
              <Button icon={<Play />} loading={running} onClick={() => void runNow()}>
                {t("list.runNow")}
              </Button>
            )}
            {canWrite && (
              <Button variant="primary" icon={<Plus />} onClick={() => navigate("/automations/new")}>
                {t("list.new")}
              </Button>
            )}
          </>
        }
      />
      <AutomationsTabs value="list" />
      <div className="p-4">
        {sorted.length === 0 ? (
          <EmptyState
            className="py-20"
            icon={<Zap />}
            title={t("list.empty")}
            description={t("list.emptyHint")}
            action={
              canWrite && (
                <Button icon={<LayoutTemplate />} onClick={() => navigate("/automations/templates")}>
                  {t("list.browseTemplates")}
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("list.name")}</Th>
                  <Th>{t("list.trigger")}</Th>
                  <Th>{t("list.actions")}</Th>
                  <Th>{t("list.lastRun")}</Th>
                  <Th className="w-20">{t("list.enabled")}</Th>
                  <Th className="w-10" />
                </Tr>
              </THead>
              <TBody>
                {sorted.map((a) => {
                  const last = lastRun(a.id);
                  return (
                    <Tr key={a.id}>
                      <Td>
                        <Link to={`/automations/${a.id}`} className="font-medium text-surface-900 hover:underline dark:text-white">
                          {a.name}
                        </Link>
                        <div className="text-xs text-surface-500">{objects.find((o) => o.id === a.object)?.labelPlural ?? a.object}</div>
                      </Td>
                      <Td className="text-sm text-surface-600 dark:text-surface-300">{triggerSummary(a)}</Td>
                      <Td className="text-sm text-surface-600 dark:text-surface-300">{t("list.actionsCount", { count: a.actions.length })}</Td>
                      <Td className="text-sm">
                        {last ? (
                          <span className="inline-flex items-center gap-2">
                            <Badge color={statusColor(last.status)} dot>
                              {t(`runs.statuses.${last.status}`)}
                            </Badge>
                            <span className="text-surface-500">{formatRelative(last.startedAt, intlLocale())}</span>
                          </span>
                        ) : (
                          <span className="text-surface-400">{t("list.never")}</span>
                        )}
                      </Td>
                      <Td>
                        <Switch size="sm" checked={a.enabled} disabled={!canWrite} label={<span className="sr-only">{t("list.enabled")}</span>} onChange={(v) => void setAutomationEnabled(ops, a.id, v).catch((e: Error) => toast.error(e.message))} />
                      </Td>
                      <Td>
                        {canWrite && (
                          <Dropdown
                            align="end"
                            trigger={({ ref, onClick }) => <IconButton ref={ref as never} size="sm" label={t("list.more")} icon={<MoreHorizontal />} onClick={onClick} />}
                            items={[
                              { id: "edit", label: t("list.edit"), icon: <Pencil />, onSelect: () => navigate(`/automations/${a.id}`) },
                              { id: "dup", label: t("list.duplicate"), icon: <Copy />, onSelect: () => void duplicateAutomation(ops, a.id).then((c) => navigate(`/automations/${c.id}`)) },
                              { id: "del", label: t("list.delete"), icon: <Trash2 />, danger: true, separator: true, onSelect: () => void remove(a.id, a.name) },
                            ]}
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
        <p className="mt-4 text-xs text-surface-500">{t("list.scheduleHint")}</p>
      </div>
    </div>
  );
}
