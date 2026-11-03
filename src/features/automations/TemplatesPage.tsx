import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, Zap } from "lucide-react";
import { useCan, useObjects, useOps, usePipelines, useUsers } from "../../app/CrmDataContext";
import { Badge, Button, Card, PageHeader } from "../../components/ui";
import { AUTOMATION_TEMPLATES, createAutomationFromTemplate } from "../../ops/automations";
import { toast } from "../../shared/lib/toast";
import { AutomationsTabs } from "./AutomationsTabs";
import { useAutomationLabels } from "./labels";

export function TemplatesPage() {
  const { t } = useTranslation("automations");
  const ops = useOps();
  const navigate = useNavigate();
  const objects = useObjects({ includeHidden: true });
  const pipelines = usePipelines();
  const users = useUsers();
  const canWrite = useCan("automations.write");
  const { triggerSummary, actionSummary } = useAutomationLabels(objects, pipelines, users);
  const [busy, setBusy] = useState<string | null>(null);

  const use = async (id: string) => {
    setBusy(id);
    try {
      const a = await createAutomationFromTemplate(ops, id, { name: t(`templates.items.${id}.name`, { defaultValue: AUTOMATION_TEMPLATES.find((x) => x.id === id)?.name }) });
      toast.success(t("templates.created"));
      navigate(`/automations/${a.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title={t("title")} icon={<Zap />} description={t("subtitle")} />
      <AutomationsTabs value="templates" />
      <div className="p-4">
        <p className="mb-4 text-sm text-surface-500">{t("templates.hint")}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AUTOMATION_TEMPLATES.map((tpl) => {
            const available = tpl.requires.every((o) => objects.some((x) => x.id === o));
            const def = tpl.build();
            return (
              <Card key={tpl.id} className="flex flex-col">
                <div className="flex h-full flex-col gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-white">{t(`templates.items.${tpl.id}.name`, { defaultValue: tpl.name })}</h3>
                    <p className="mt-1 text-sm text-surface-500">{t(`templates.items.${tpl.id}.description`, { defaultValue: tpl.description })}</p>
                  </div>
                  <div className="space-y-1 text-xs text-surface-600 dark:text-surface-300">
                    <div>
                      <Badge color="blue">{t("templates.when")}</Badge> {triggerSummary(def)}
                    </div>
                    {def.actions.map((a, i) => (
                      <div key={i}>
                        <Badge color="green">{t("templates.then")}</Badge> {actionSummary(a, def.object)}
                      </div>
                    ))}
                  </div>
                  {canWrite && (
                    <div className="mt-auto flex gap-2 pt-2">
                      <Button size="sm" variant="primary" icon={<Plus />} disabled={!available} loading={busy === tpl.id} onClick={() => void use(tpl.id)}>
                        {t("templates.use")}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Pencil />} disabled={!available} onClick={() => navigate(`/automations/new?template=${tpl.id}`)}>
                        {t("templates.customize")}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
