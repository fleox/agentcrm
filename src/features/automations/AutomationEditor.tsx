import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Play, Save, Trash2, Zap } from "lucide-react";
import { useAutomationRuns, useCan, useDoc, useObjects, useOps, usePipelines, useRecords, useUsers } from "../../app/CrmDataContext";
import { Badge, Button, Card, confirmDialog, EmptyState, FieldInput, FormField, Input, PageHeader, Select, Switch } from "../../components/ui";
import { recordLabel } from "../../core/fields";
import type { Automation, AutomationRun, AutomationTrigger, AutomationTriggerType, Filter } from "../../core/types";
import { createAutomation, deleteAutomation, findAutomationTemplate, testAutomation, TRIGGER_TYPES, updateAutomation, type AutomationInput } from "../../ops/automations";
import { toast } from "../../shared/lib/toast";
import { formatDateTime } from "../../shared/lib/utils";
import { intlLocale } from "../../i18n";
import { ActionsEditor } from "./ActionsEditor";
import { ConditionBuilder } from "./ConditionBuilder";
import { statusColor } from "./labels";

const EVENT_LIKE: AutomationTriggerType[] = ["record.created", "record.updated", "field.changed", "stage.changed"];

function blank(object: string): AutomationInput {
  return { name: "", enabled: true, object, trigger: { type: "record.created" }, conditions: [], actions: [] };
}

export function AutomationEditorPage() {
  const { automationId } = useParams();
  const [search] = useSearchParams();
  const existing = useDoc<Automation>("automations", automationId && automationId !== "new" ? automationId : undefined);
  const objects = useObjects({ includeHidden: true });
  const { t } = useTranslation("automations");
  if (automationId && automationId !== "new" && !existing) {
    return <EmptyState className="py-24" icon={<Zap />} title={t("editor.notFound")} />;
  }
  const templateId = search.get("template");
  const template = templateId ? findAutomationTemplate(templateId) : undefined;
  const initial: AutomationInput = existing
    ? { name: existing.name, enabled: existing.enabled, object: existing.object, trigger: existing.trigger, conditions: existing.conditions, actions: existing.actions }
    : template
      ? { ...template.build(), name: t(`templates.items.${template.id}.name`, { defaultValue: template.name }) }
      : blank(objects.find((o) => o.id === "deals")?.id ?? objects[0]?.id ?? "people");
  return <AutomationEditor key={existing?.id ?? templateId ?? "new"} id={existing?.id} initial={initial} />;
}

function AutomationEditor({ id, initial }: { id?: string; initial: AutomationInput }) {
  const { t } = useTranslation("automations");
  const ops = useOps();
  const navigate = useNavigate();
  const objects = useObjects({ includeHidden: true });
  const users = useUsers();
  const pipelines = usePipelines();
  const canWrite = useCan("automations.write");
  const [draft, setDraft] = useState<AutomationInput>(() => JSON.parse(JSON.stringify(initial)) as AutomationInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const object = objects.find((o) => o.id === draft.object);
  const objectPipelines = pipelines.filter((p) => p.object === draft.object);
  const set = (patch: Partial<AutomationInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setTrigger = (patch: Partial<AutomationTrigger>) => setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...patch } }));

  const triggerTypes = TRIGGER_TYPES.filter((ty) => ty !== "stage.changed" || objectPipelines.length > 0);
  const triggerField = object?.fields.find((f) => f.id === draft.trigger.field);
  const watchable = (object?.fields ?? []).filter((f) => !f.hidden);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = id ? await updateAutomation(ops, id, draft) : await createAutomation(ops, draft);
      toast.success(t("editor.saved"));
      if (!id) navigate(`/automations/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    if (!(await confirmDialog({ title: t("list.deleteConfirm", { name: draft.name }), description: t("list.deleteConfirmBody"), danger: true, confirmLabel: t("list.delete") }))) return;
    await deleteAutomation(ops, id);
    toast.success(t("list.deleted"));
    navigate("/automations");
  };

  const stageOptions = [
    { value: "", label: t("trigger.anyStage") },
    { value: "won", label: t("trigger.wonKind") },
    { value: "lost", label: t("trigger.lostKind") },
    ...objectPipelines.flatMap((p) => p.stages.map((s) => ({ value: `stage:${s.id}`, label: objectPipelines.length > 1 ? `${p.name} · ${s.label}` : s.label }))),
  ];
  const stageValue = draft.trigger.to === undefined || draft.trigger.to === "" ? "" : draft.trigger.to === "won" || draft.trigger.to === "lost" ? String(draft.trigger.to) : `stage:${String(draft.trigger.to)}`;

  return (
    <div>
      <PageHeader
        title={id ? draft.name || t("editor.editTitle") : t("editor.newTitle")}
        icon={<Zap />}
        actions={
          <>
            <Button variant="ghost" icon={<ArrowLeft />} onClick={() => navigate("/automations")}>
              {t("editor.back")}
            </Button>
            {id && canWrite && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => void remove()}>
                {t("list.delete")}
              </Button>
            )}
            {canWrite && (
              <Button variant="primary" icon={<Save />} loading={saving} onClick={() => void save()}>
                {t("editor.save")}
              </Button>
            )}
          </>
        }
      />
      <form data-form-type="other" onSubmit={(e) => void save(e)} className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
          <Card>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <FormField label={t("editor.name")} htmlFor="automation-name">
                <Input id="automation-name" value={draft.name} disabled={!canWrite} placeholder={t("editor.namePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
              </FormField>
              <FormField label={t("editor.object")} htmlFor="automation-object">
                <Select
                  id="automation-object"
                  value={draft.object}
                  disabled={!canWrite}
                  options={objects.map((o) => ({ value: o.id, label: o.labelPlural }))}
                  onChange={(e) => set({ object: e.target.value, conditions: [], trigger: { type: draft.trigger.type === "stage.changed" ? "record.created" : draft.trigger.type, days: draft.trigger.days, everyHours: draft.trigger.everyHours }, actions: [] })}
                />
              </FormField>
              <div className="pb-1.5">
                <Switch checked={draft.enabled !== false} disabled={!canWrite} label={t("list.enabled")} onChange={(v) => set({ enabled: v })} />
              </div>
            </div>
          </Card>

          <Card title={t("trigger.title")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t("trigger.when")}>
                <Select
                  value={draft.trigger.type}
                  disabled={!canWrite}
                  options={triggerTypes.map((ty) => ({ value: ty, label: t(`trigger.types.${ty}`) }))}
                  onChange={(e) => {
                    const type = e.target.value as AutomationTriggerType;
                    set({ trigger: { type, ...(type === "inactivity" ? { days: draft.trigger.days ?? 14 } : {}), ...(type === "schedule" ? { everyHours: draft.trigger.everyHours ?? 24 } : {}), ...(type === "field.changed" ? { field: watchable[0]?.id } : {}) } });
                  }}
                />
              </FormField>
              {(draft.trigger.type === "field.changed" || draft.trigger.type === "record.updated") && (
                <FormField label={t("trigger.field")}>
                  <Select
                    value={draft.trigger.field ?? ""}
                    disabled={!canWrite}
                    options={[...(draft.trigger.type === "record.updated" ? [{ value: "", label: t("trigger.anyField") }] : []), ...watchable.map((f) => ({ value: f.id, label: f.label }))]}
                    onChange={(e) => setTrigger({ field: e.target.value || undefined, to: undefined })}
                  />
                </FormField>
              )}
              {draft.trigger.type === "field.changed" && triggerField && (
                <FormField label={t("trigger.to")} help={t("trigger.toHint")}>
                  <FieldInput field={{ ...triggerField, required: false, type: triggerField.type === "multiSelect" ? "select" : triggerField.type }} value={draft.trigger.to} disabled={!canWrite} onChange={(v) => setTrigger({ to: v })} />
                </FormField>
              )}
              {draft.trigger.type === "stage.changed" && (
                <FormField label={t("trigger.stage")}>
                  <Select value={stageValue} disabled={!canWrite} options={stageOptions} onChange={(e) => setTrigger({ to: e.target.value === "" ? undefined : e.target.value.startsWith("stage:") ? e.target.value.slice(6) : e.target.value })} />
                </FormField>
              )}
              {draft.trigger.type === "inactivity" && (
                <FormField label={t("trigger.days")}>
                  <Input type="number" min={1} value={draft.trigger.days ?? ""} disabled={!canWrite} onChange={(e) => setTrigger({ days: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </FormField>
              )}
              {draft.trigger.type === "schedule" && (
                <FormField label={t("trigger.everyHours")}>
                  <Input type="number" min={1} value={draft.trigger.everyHours ?? ""} disabled={!canWrite} onChange={(e) => setTrigger({ everyHours: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </FormField>
              )}
            </div>
            {!EVENT_LIKE.includes(draft.trigger.type) && <p className="mt-3 text-xs text-surface-500">{t("list.scheduleHint")}</p>}
          </Card>

          <Card title={t("conditions.title")}>
            <p className="mb-2 text-xs text-surface-500">{t("conditions.hint")}</p>
            <ConditionBuilder object={object} value={draft.conditions ?? []} disabled={!canWrite} onChange={(conditions: Filter[]) => set({ conditions })} />
          </Card>

          <Card title={t("actions.title")}>
            <ActionsEditor object={object} users={users} value={draft.actions} disabled={!canWrite} onChange={(actions) => set({ actions })} />
          </Card>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </div>
        <aside className="space-y-4">
          <TestPanel draft={draft} id={id} />
          {id && <RecentRuns automationId={id} />}
        </aside>
      </form>
    </div>
  );
}

function TestPanel({ draft, id }: { draft: AutomationInput; id?: string }) {
  const { t } = useTranslation("automations");
  const ops = useOps();
  const objects = useObjects({ includeHidden: true });
  const records = useRecords(draft.object);
  const canRun = useCan("automations.run");
  const canWriteRecords = useCan("records.write");
  const object = objects.find((o) => o.id === draft.object);
  const [query, setQuery] = useState("");
  const [recordId, setRecordId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ matched: boolean; run: AutomationRun; dryRun: boolean } | null>(null);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records
      .map((r) => ({ value: r.id, label: recordLabel(object, r) }))
      .filter((o) => !q || o.label.toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 200);
  }, [records, object, query]);
  const selected = recordId || options[0]?.value || "";

  const run = async (dryRun: boolean) => {
    if (!selected) return;
    if (!dryRun && !(await confirmDialog({ title: t("test.confirmReal"), description: t("test.confirmRealBody") }))) return;
    setBusy(true);
    try {
      const res = await testAutomation(ops, { ...draft, ...(id ? { id } : {}) }, selected, { dryRun });
      setResult({ matched: res.matched, run: res.run, dryRun });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!canRun) return null;
  return (
    <Card title={t("test.title")}>
      <p className="mb-3 text-xs text-surface-500">{t("test.hint")}</p>
      <div className="space-y-2">
        <Input placeholder={t("test.search")} value={query} aria-label={t("test.search")} onChange={(e) => setQuery(e.target.value)} />
        <Select aria-label={t("test.record")} value={selected} placeholder={t("test.pickRecord")} options={options} onChange={(e) => setRecordId(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<FlaskConical />} loading={busy} disabled={!selected || !draft.actions.length} onClick={() => void run(true)}>
            {t("test.dryRun")}
          </Button>
          {canWriteRecords && (
            <Button size="sm" variant="ghost" icon={<Play />} disabled={busy || !selected || !draft.actions.length} onClick={() => void run(false)}>
              {t("test.runNow")}
            </Button>
          )}
        </div>
      </div>
      {result && (
        <div className="mt-3 space-y-2 rounded-md bg-surface-50 p-2 text-sm dark:bg-surface-900/60">
          <div className="flex items-center gap-2">
            <Badge color={result.matched ? statusColor(result.run.status) : "gray"} dot>
              {result.matched ? (result.dryRun ? t("test.matched") : t(`runs.statuses.${result.run.status}`)) : t("test.notMatched")}
            </Badge>
          </div>
          {result.matched ? (
            <ul className="space-y-1">
              {(result.run.actions ?? []).map((a, i) => (
                <li key={i} className={a.ok ? "text-surface-700 dark:text-surface-200" : "text-red-600 dark:text-red-400"}>
                  {i + 1}. {a.message ?? t(`actions.types.${a.type}`)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-surface-500">{t("test.notMatchedHint")}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function RecentRuns({ automationId }: { automationId: string }) {
  const { t } = useTranslation("automations");
  const runs = useAutomationRuns()
    .filter((r) => r.automationId === automationId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 8);
  const navigate = useNavigate();
  return (
    <Card
      title={t("runs.recent")}
      actions={
        <Button size="xs" variant="ghost" onClick={() => navigate(`/automations/runs?automation=${automationId}`)}>
          {t("widget.viewAll")}
        </Button>
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-surface-500">{t("runs.empty")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {runs.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              <Badge color={statusColor(r.status)} dot>
                {t(`runs.statuses.${r.status}`)}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-surface-500">{formatDateTime(r.startedAt, intlLocale())}</span>
                {r.message && <span className="block truncate text-xs text-surface-600 dark:text-surface-300" title={r.message}>{r.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

