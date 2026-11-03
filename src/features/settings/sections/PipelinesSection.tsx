// Pipelines: per object, create / rename / delete (records move to another
// pipeline) and a stage editor (label, color, probability, kind, drag
// reorder, add / remove — records on removed stages move to a chosen one).

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, FormField, IconButton, Input, Modal, ObjectIcon, Select, Tabs, dotClass } from "../../../components/ui";
import { useCan, useObjects, useOps, usePipelines, useRecords } from "../../../app/CrmDataContext";
import { colorAt } from "../../../core/fields";
import type { ObjectDef, Pipeline, StageKind } from "../../../core/types";
import { createPipeline, deletePipeline, updatePipeline, type StageInput } from "../../../ops/pipelines";
import { cn } from "../../../shared/lib/utils";
import { ColorDot, ReadOnlyNote, SectionHeader, SortableItem, SortableList, runOp } from "../components/common";

interface DraftStage {
  key: string;
  id?: string;
  label: string;
  color: string;
  probability: string;
  kind: StageKind;
}

let seq = 0;
const key = () => `stage:${++seq}`;

function pipelineObjects(objects: ObjectDef[], pipelines: Pipeline[]): ObjectDef[] {
  return objects.filter((o) => pipelines.some((p) => p.object === o.id) || o.fields.some((f) => f.id === "stage" && f.type === "select"));
}

export function PipelinesSection() {
  const { t } = useTranslation("settings");
  const objects = useObjects();
  const all = usePipelines();
  const canEdit = useCan("pipelines.write");
  const candidates = pipelineObjects(objects, all);
  const [objectId, setObjectId] = useState(candidates[0]?.id ?? "deals");
  const object = candidates.find((o) => o.id === objectId) ?? candidates[0];
  const [editing, setEditing] = useState<Pipeline | "new" | null>(null);
  const [deleting, setDeleting] = useState<Pipeline | null>(null);

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title={t("pipelines.title")}
        description={t("pipelines.description")}
        actions={
          canEdit &&
          object && (
            <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
              {t("pipelines.new")}
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNote />}
      {candidates.length > 1 && <Tabs className="mb-4" tabs={candidates.map((o) => ({ id: o.id, label: o.labelPlural, icon: <ObjectIcon name={o.icon} /> }))} value={object?.id ?? ""} onChange={setObjectId} />}
      {!object ? (
        <EmptyState icon={<GitBranch />} title={t("pipelines.noObject")} description={t("pipelines.noObjectHelp")} />
      ) : (
        <PipelineList object={object} canEdit={canEdit} onEdit={setEditing} onDelete={setDeleting} />
      )}
      {editing && object && <PipelineEditor object={object} pipeline={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeletePipelineModal pipeline={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function PipelineList({ object, canEdit, onEdit, onDelete }: { object: ObjectDef; canEdit: boolean; onEdit(p: Pipeline): void; onDelete(p: Pipeline): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const pipelines = usePipelines(object.id);
  const records = useRecords(object.id);
  if (!pipelines.length) return <EmptyState icon={<GitBranch />} title={t("pipelines.empty")} />;
  return (
    <div className="space-y-3">
      {pipelines.map((p) => {
        const count = (stageId: string) => records.filter((r) => r.fields[p.stageField] === stageId).length;
        const total = p.stages.reduce((n, s) => n + count(s.id), 0);
        return (
          <Card
            key={p.id}
            data-testid={`pipeline-${p.id}`}
            title={
              <span className="inline-flex items-center gap-2">
                {p.name}
                <span className="text-xs font-normal text-surface-500">
                  {t("pipelines.stageCount", { count: p.stages.length })} · {t("dataModel.recordCount", { count: total })}
                </span>
              </span>
            }
            actions={
              canEdit && (
                <>
                  <IconButton size="sm" label={tc("common.edit")} icon={<Pencil />} onClick={() => onEdit(p)} />
                  {pipelines.length > 1 && <IconButton size="sm" label={tc("common.delete")} icon={<Trash2 />} onClick={() => onDelete(p)} />}
                </>
              )
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {p.stages.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-md border border-surface-200 px-2 py-1 text-[13px] dark:border-surface-700">
                  <span className={cn("h-2 w-2 rounded-full", dotClass(s.color))} />
                  <span className="font-medium text-surface-800 dark:text-surface-100">{s.label}</span>
                  <span className="text-xs tabular-nums text-surface-500">{s.probability}%</span>
                  {s.kind !== "open" && <Badge color={s.kind === "won" ? "green" : "red"}>{t(`pipelines.kinds.${s.kind}`)}</Badge>}
                  <span className="text-xs tabular-nums text-surface-400">({count(s.id)})</span>
                </span>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function toDraft(p: Pipeline | null, t: (k: string) => string): DraftStage[] {
  if (p) return p.stages.map((s) => ({ key: s.id, id: s.id, label: s.label, color: s.color, probability: String(s.probability), kind: s.kind }));
  return [
    { key: key(), label: t("pipelines.defaultNew"), color: colorAt(1), probability: "10", kind: "open" },
    { key: key(), label: t("pipelines.defaultQualified"), color: colorAt(3), probability: "40", kind: "open" },
    { key: key(), label: t("pipelines.defaultWon"), color: "green", probability: "100", kind: "won" },
    { key: key(), label: t("pipelines.defaultLost"), color: "red", probability: "0", kind: "lost" },
  ];
}

function PipelineEditor({ object, pipeline, onClose }: { object: ObjectDef; pipeline: Pipeline | null; onClose(): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const records = useRecords(object.id, { includeDeleted: true });
  const [name, setName] = useState(pipeline?.name ?? "");
  const [stages, setStages] = useState<DraftStage[]>(() => toDraft(pipeline, t));
  const [moveTo, setMoveTo] = useState("");
  const [saving, setSaving] = useState(false);

  const stageField = pipeline?.stageField ?? "stage";
  const removed = useMemo(() => (pipeline?.stages ?? []).filter((s) => !stages.some((d) => d.id === s.id)), [pipeline, stages]);
  const removedCount = records.filter((r) => removed.some((s) => s.id === r.fields[stageField])).length;
  const existingKept = stages.filter((s) => s.id);

  const patch = (k: string, p: Partial<DraftStage>) => setStages(stages.map((s) => (s.key === k ? { ...s, ...p } : s)));

  const submit = async () => {
    const input: StageInput[] = stages.map((s) => ({ ...(s.id ? { id: s.id } : {}), label: s.label, color: s.color, probability: Math.max(0, Math.min(100, Number(s.probability) || 0)), kind: s.kind }));
    setSaving(true);
    const res = pipeline
      ? await runOp(() => updatePipeline(ops, pipeline.id, { name, stages: input, ...(removed.length && moveTo ? { moveRemovedTo: moveTo } : {}) }), (p) => t("pipelines.saved", { name: p.name }))
      : await runOp(() => createPipeline(ops, { name, object: object.id, stages: input }), (p) => t("pipelines.created", { name: p.name }));
    setSaving(false);
    if (res) onClose();
  };

  return (
    <Modal open onClose={onClose} size="lg" dismissible={false} title={pipeline ? t("pipelines.editTitle", { name: pipeline.name }) : t("pipelines.new")}>
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label={t("pipelines.name")} htmlFor="pipeline-name">
          <Input id="pipeline-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("pipelines.namePlaceholder")} />
        </FormField>
        <div>
          <div className="mb-1 grid grid-cols-[20px_24px_1fr_80px_100px_24px] items-center gap-1.5 px-1.5 text-xs font-medium text-surface-500">
            <span />
            <span />
            <span>{t("pipelines.stage")}</span>
            <span>{t("pipelines.probability")}</span>
            <span>{t("pipelines.kind")}</span>
            <span />
          </div>
          <div className="overflow-hidden rounded-md border border-surface-200 dark:border-surface-800" data-testid="stages-list">
            <SortableList ids={stages.map((s) => s.key)} onReorder={(keys) => setStages(keys.map((k) => stages.find((s) => s.key === k)!))}>
              {stages.map((s) => (
                <SortableItem key={s.key} id={s.key} handleLabel={t("fields.dragHandle")} className="border-b border-surface-100 bg-white last:border-b-0 dark:border-surface-800 dark:bg-surface-900">
                  {(handle) => (
                    <div className="grid grid-cols-[20px_24px_1fr_80px_100px_24px] items-center gap-1.5 px-1.5 py-1">
                      {handle}
                      <ColorDot value={s.color} label={t("pipelines.color")} onChange={(c) => patch(s.key, { color: c })} />
                      <Input aria-label={t("pipelines.stage")} required value={s.label} className="h-7" onChange={(e) => patch(s.key, { label: e.target.value })} />
                      <Input aria-label={t("pipelines.probability")} type="number" min={0} max={100} value={s.probability} className="h-7" onChange={(e) => patch(s.key, { probability: e.target.value })} />
                      <Select
                        aria-label={t("pipelines.kind")}
                        value={s.kind}
                        options={(["open", "won", "lost"] as StageKind[]).map((k) => ({ value: k, label: t(`pipelines.kinds.${k}`) }))}
                        onChange={(e) => patch(s.key, { kind: e.target.value as StageKind })}
                      />
                      <IconButton size="xs" label={tc("common.remove")} icon={<X />} disabled={stages.length <= 1} onClick={() => setStages(stages.filter((x) => x.key !== s.key))} />
                    </div>
                  )}
                </SortableItem>
              ))}
            </SortableList>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1.5"
            icon={<Plus />}
            onClick={() => setStages([...stages.filter((s) => s.kind === "open"), { key: key(), label: "", color: colorAt(stages.length), probability: "50", kind: "open" }, ...stages.filter((s) => s.kind !== "open")])}
          >
            {t("pipelines.addStage")}
          </Button>
        </div>
        {removed.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="mb-2">{t("pipelines.removedStages", { stages: removed.map((s) => s.label).join(", "), count: removedCount })}</p>
            {removedCount > 0 && (
              <FormField label={t("pipelines.moveRemovedTo")} htmlFor="pipeline-move-to">
                <Select id="pipeline-move-to" value={moveTo} options={[{ value: "", label: t("pipelines.firstOpenStage") }, ...existingKept.map((s) => ({ value: s.id!, label: s.label }))]} onChange={(e) => setMoveTo(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-surface-100 pt-3 dark:border-surface-800">
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={pipeline ? <Save /> : <Plus />} loading={saving} disabled={!name.trim() || stages.some((s) => !s.label.trim())}>
            {pipeline ? tc("common.save") : tc("common.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeletePipelineModal({ pipeline, onClose }: { pipeline: Pipeline; onClose(): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const others = usePipelines(pipeline.object).filter((p) => p.id !== pipeline.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={tc("confirm.deleteTitle", { name: pipeline.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await runOp(() => deletePipeline(ops, pipeline.id, { moveTo }), (r) => t("pipelines.deleted", { name: pipeline.name, count: r.moved }));
              setBusy(false);
              if (res) onClose();
            }}
          >
            {tc("common.delete")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-surface-600 dark:text-surface-300">{t("pipelines.deleteHelp")}</p>
      <FormField label={t("pipelines.moveRecordsTo")} htmlFor="pipeline-delete-move">
        <Select id="pipeline-delete-move" value={moveTo} options={others.map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => setMoveTo(e.target.value)} />
      </FormField>
    </Modal>
  );
}
