// Fields of one object: sortable list (reorderFields), type badges, lock
// markers (system / standard / pipeline-managed), create / edit / delete.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, GitBranch, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, IconButton, confirmDialog } from "../../../components/ui";
import { useCan, useOps, usePipelines, useRecords } from "../../../app/CrmDataContext";
import { isEmptyFieldValue } from "../../../core/fields";
import type { FieldDef, ObjectDef, Pipeline } from "../../../core/types";
import { deleteField, reorderFields } from "../../../ops/schema";
import { SortableItem, SortableList, runOp } from "../components/common";
import { FieldFormModal } from "./FieldFormModal";

export function isPipelineManagedField(pipelines: Pipeline[], objectId: string, fieldId: string): boolean {
  const own = pipelines.filter((p) => p.object === objectId);
  return own.some((p) => p.stageField === fieldId) || (fieldId === "pipeline" && own.length > 0);
}

export function FieldsEditor({ object }: { object: ObjectDef }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const canEdit = useCan("schema.write");
  const pipelines = usePipelines(object.id);
  const records = useRecords(object.id, { includeDeleted: true });
  const [order, setOrder] = useState(object.fields.map((f) => f.id));
  const [editing, setEditing] = useState<FieldDef | "new" | null>(null);

  useEffect(() => setOrder(object.fields.map((f) => f.id)), [object.fields]);

  const byId = new Map(object.fields.map((f) => [f.id, f]));
  const fields = order.map((id) => byId.get(id)).filter((f): f is FieldDef => !!f);

  const remove = async (f: FieldDef) => {
    const used = records.filter((r) => !isEmptyFieldValue(f, r.fields[f.id])).length;
    const ok = await confirmDialog({
      title: tc("confirm.deleteTitle", { name: f.label }),
      description: t("fields.deleteConfirm", { count: used }),
      confirmLabel: tc("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await runOp(() => deleteField(ops, object.id, f.id), (r) => t("fields.deleted", { name: f.label, count: r.cleared }));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-surface-900 dark:text-white">{t("fields.title", { count: fields.length })}</h3>
        {canEdit && (
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
            {t("fields.add")}
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900" data-testid="fields-list">
        <SortableList
          ids={order}
          disabled={!canEdit}
          onReorder={(next) => {
            setOrder(next);
            void runOp(() => reorderFields(ops, object.id, next));
          }}
        >
          {fields.map((f) => {
            const managed = isPipelineManagedField(pipelines, object.id, f.id);
            const deletable = canEdit && !f.system && !f.standard && !managed && f.id !== object.labelField;
            return (
              <SortableItem key={f.id} id={f.id} disabled={!canEdit} handleLabel={t("fields.dragHandle")} className="border-b border-surface-100 bg-white last:border-b-0 dark:border-surface-800 dark:bg-surface-900">
                {(handle) => (
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800/50" data-testid={`field-row-${f.id}`}>
                    {handle}
                    <button type="button" className="min-w-0 flex-1 text-left focus:outline-none" onClick={() => setEditing(f)}>
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-surface-900 dark:text-white">{f.label}</span>
                        {f.required && <span className="text-xs text-red-500" title={t("fields.required")}>*</span>}
                        {f.id === object.labelField && <Badge color="blue">{t("fields.labelField")}</Badge>}
                        {f.hidden && <EyeOff className="h-3.5 w-3.5 text-surface-400" aria-label={t("fields.hidden")} />}
                      </span>
                      <span className="block truncate text-xs text-surface-500">
                        {f.id}
                        {f.description ? ` · ${f.description}` : ""}
                      </span>
                    </button>
                    <div className="hidden items-center gap-1 sm:flex">
                      {managed && (
                        <Badge color="indigo">
                          <span className="inline-flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            {t("fields.managedByPipelines")}
                          </span>
                        </Badge>
                      )}
                      {f.system ? (
                        <Badge>
                          <span className="inline-flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            {t("fields.system")}
                          </span>
                        </Badge>
                      ) : f.standard ? (
                        <Badge>{t("fields.standard")}</Badge>
                      ) : (
                        <Badge color="purple">{t("fields.custom")}</Badge>
                      )}
                    </div>
                    <Badge color="teal" className="w-28 justify-center">
                      {tc(`fieldTypes.${f.type}`)}
                      {f.type === "relation" && f.relation ? ` → ${f.relation.object}` : ""}
                    </Badge>
                    <div className="flex w-14 items-center justify-end gap-0.5">
                      <IconButton size="xs" label={canEdit ? tc("common.edit") : t("fields.view")} icon={<Pencil />} onClick={() => setEditing(f)} />
                      {deletable && <IconButton size="xs" label={tc("common.delete")} icon={<Trash2 />} onClick={() => remove(f)} />}
                    </div>
                  </div>
                )}
              </SortableItem>
            );
          })}
        </SortableList>
      </div>
      {canEdit && <p className="mt-2 text-xs text-surface-500">{t("fields.reorderHelp")}</p>}
      {editing && <FieldFormModal object={object} field={editing === "new" ? null : editing} readOnly={!canEdit} onClose={() => setEditing(null)} />}
    </div>
  );
}
