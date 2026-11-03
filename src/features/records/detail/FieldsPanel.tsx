// Left panel of the record page: every field editable inline (click or
// Enter), empty fields collapsible, relations as chips, record metadata.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { isEmptyFieldValue } from "../../../core/fields";
import type { CrmRecord, FieldDef, ObjectDef } from "../../../core/types";
import { FieldValue, useFieldContext } from "../../../components/ui";
import { useCan, useOps } from "../../../app/CrmDataContext";
import { updateRecord } from "../../../ops/records";
import { toast } from "../../../shared/lib/toast";
import { cn, formatDateTime } from "../../../shared/lib/utils";
import { CellEditor } from "../table/CellEditor";

function FieldRow({ field, value, canWrite, onSave }: { field: FieldDef; value: unknown; canWrite: boolean; onSave(v: unknown): void }) {
  const { t } = useTranslation("records");
  const [editing, setEditing] = useState(false);
  const editable = canWrite;
  return (
    <div className="group flex min-h-8 items-start gap-2" data-field={field.id}>
      <dt className="w-28 shrink-0 truncate pt-1.5 text-xs text-surface-500" title={field.description ?? field.label}>
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </dt>
      <dd className="min-w-0 flex-1">
        {editing ? (
          <CellEditor field={field} value={value} onCommit={onSave} onClose={() => setEditing(false)} />
        ) : (
          <button
            type="button"
            disabled={!editable}
            aria-label={t("detail.editField", { field: field.label })}
            onClick={() => setEditing(true)}
            className={cn(
              "flex min-h-8 w-full min-w-0 items-center rounded-md px-1.5 py-1 text-left text-[13px] text-surface-800 dark:text-surface-100",
              editable && "hover:bg-surface-100 dark:hover:bg-surface-800",
              !editable && "cursor-default",
            )}
          >
            <span className="min-w-0 flex-1">
              <FieldValue field={field} value={value} emptyText={editable ? t("detail.emptyValue") : "—"} />
            </span>
          </button>
        )}
      </dd>
    </div>
  );
}

export function FieldsPanel({ record, object }: { record: CrmRecord; object: ObjectDef }) {
  const { t } = useTranslation("records");
  const ops = useOps();
  const ctx = useFieldContext();
  const canWrite = useCan("records.write") && !record.deletedAt;
  const [showEmpty, setShowEmpty] = useState(false);
  const fields = object.fields.filter((f) => !f.hidden && f.id !== object.labelField);
  const filled = fields.filter((f) => !isEmptyFieldValue(f, record.fields[f.id]));
  const empty = fields.filter((f) => isEmptyFieldValue(f, record.fields[f.id]));

  const save = async (fieldId: string, value: unknown) => {
    if (JSON.stringify(value ?? null) === JSON.stringify(record.fields[fieldId] ?? null)) return;
    try {
      await updateRecord(ops, record.id, { [fieldId]: value ?? null });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const ownerField: FieldDef = { id: "ownerId", label: t("detail.owner"), type: "user" };
  const creator = ctx.users.find((u) => u.id === record.createdBy);

  return (
    <div className="space-y-3" data-testid="fields-panel">
      <dl className="space-y-0.5">
        {filled.map((f) => (
          <FieldRow key={f.id} field={f} value={record.fields[f.id]} canWrite={canWrite} onSave={(v) => void save(f.id, v)} />
        ))}
        {empty.length > 0 && (
          <>
            <button type="button" onClick={() => setShowEmpty((s) => !s)} className="flex h-7 items-center gap-1 px-0.5 text-xs text-surface-400 hover:text-surface-700 dark:hover:text-surface-200" aria-expanded={showEmpty}>
              {showEmpty ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {showEmpty ? t("detail.hideEmpty") : t("detail.showEmpty", { count: empty.length })}
            </button>
            {showEmpty && empty.map((f) => <FieldRow key={f.id} field={f} value={record.fields[f.id]} canWrite={canWrite} onSave={(v) => void save(f.id, v)} />)}
          </>
        )}
      </dl>
      <dl className="space-y-0.5 border-t border-surface-100 pt-3 dark:border-surface-800">
        <FieldRow
          field={ownerField}
          value={record.ownerId}
          canWrite={canWrite}
          onSave={(v) => {
            if ((v ?? null) === (record.ownerId ?? null)) return;
            void updateRecord(ops, record.id, {}, { ownerId: (v as string | undefined) ?? null }).catch((err) => toast.error((err as Error).message));
          }}
        />
        <div className="flex min-h-7 items-center gap-2 text-xs">
          <dt className="w-28 shrink-0 text-surface-500">{t("detail.created")}</dt>
          <dd className="text-surface-600 dark:text-surface-300">
            {formatDateTime(record.createdAt, ctx.locale)}
            {creator ? ` · ${creator.name}` : ""}
          </dd>
        </div>
        <div className="flex min-h-7 items-center gap-2 text-xs">
          <dt className="w-28 shrink-0 text-surface-500">{t("detail.updated")}</dt>
          <dd className="text-surface-600 dark:text-surface-300">{formatDateTime(record.updatedAt, ctx.locale)}</dd>
        </div>
      </dl>
    </div>
  );
}
