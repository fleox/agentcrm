// Floating bar shown while rows are selected: update a field, assign an
// owner, export the selection as CSV, delete.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, PenLine, Trash2, UserRound, X } from "lucide-react";
import type { CrmUser, FieldDef, ObjectDef } from "../../../core/types";
import { Button, confirmDialog, downloadCsv, FieldInput, fileStamp, Popover, Select, usePopover } from "../../../components/ui";
import { useCan, useOps, useUsers } from "../../../app/CrmDataContext";
import { bulkDelete, bulkUpdate, updateRecord } from "../../../ops/records";
import { exportCsv } from "../../../ops/exportCsv";
import { toast } from "../../../shared/lib/toast";

function editableBulkFields(object: ObjectDef): FieldDef[] {
  return object.fields.filter((f) => !f.hidden && !f.unique && f.id !== object.labelField && !(f.system && f.id !== "stage"));
}

export function BulkActions({ object, ids, onClear }: { object: ObjectDef; ids: string[]; onClear(): void }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const users = useUsers();
  const canWrite = useCan("records.write");
  const canDelete = useCan("records.delete");
  const canExport = useCan("export");
  const update = usePopover();
  const owner = usePopover();
  const fields = editableBulkFields(object);
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? "");
  const [value, setValue] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const field = fields.find((f) => f.id === fieldId);

  const applyUpdate = async () => {
    if (!field) return;
    setBusy(true);
    try {
      const res = await bulkUpdate(ops, ids, { [field.id]: value ?? null });
      if (res.errors.length) toast.warn(t("bulk.partial", { ok: res.updated.length, failed: res.errors.length, message: res.errors[0].message }));
      else toast.success(t("bulk.updated", { count: res.updated.length }));
      update.close();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const assign = async (user: CrmUser | null) => {
    owner.close();
    setBusy(true);
    let ok = 0;
    try {
      for (const id of ids) {
        await updateRecord(ops, id, {}, { ownerId: user?.id ?? null });
        ok++;
      }
      toast.success(t("bulk.assigned", { count: ok, name: user?.name ?? t("bulk.nobody") }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportSelection = () => {
    try {
      const csv = exportCsv(ops, object.id, { filters: [{ field: "id", op: "in", value: ids }], includeId: true });
      downloadCsv(`${object.id}-selection-${fileStamp()}`, csv);
      toast.success(t("bulk.exported", { count: ids.length }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: t("bulk.deleteTitle", { count: ids.length }), description: t("bulk.deleteHint"), danger: true, confirmLabel: tc("common.delete") }))) return;
    try {
      await bulkDelete(ops, ids);
      toast.success(t("bulk.deleted", { count: ids.length }));
      onClear();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div role="toolbar" aria-label={t("bulk.title")} data-testid="bulk-actions" className="pointer-events-auto flex animate-scale-in items-center gap-1 rounded-lg border border-surface-200 bg-white px-2 py-1.5 shadow-pop dark:border-surface-700 dark:bg-surface-900">
      <span className="px-1.5 text-[13px] font-medium tabular-nums">{t("bulk.selected", { count: ids.length })}</span>
      <span className="mx-1 h-4 w-px bg-surface-200 dark:bg-surface-700" />
      {canWrite && fields.length > 0 && (
        <>
          <Button ref={update.anchorRef as never} size="xs" variant="ghost" icon={<PenLine />} onClick={update.toggle} disabled={busy}>
            {t("bulk.update")}
          </Button>
          <Popover open={update.open} onClose={update.close} anchor={update.anchor}>
            <form
              data-form-type="other"
              className="w-72 space-y-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void applyUpdate();
              }}
            >
              <Select
                aria-label={t("bulk.field")}
                value={fieldId}
                onChange={(e) => {
                  setFieldId(e.target.value);
                  setValue(undefined);
                }}
                options={fields.map((f) => ({ value: f.id, label: f.label }))}
              />
              {field && <FieldInput key={field.id} field={field} value={value} onChange={setValue} />}
              <p className="text-2xs text-surface-400">{t("bulk.updateHint", { count: ids.length })}</p>
              <div className="flex justify-end">
                <Button type="submit" size="sm" variant="primary" loading={busy} icon={<PenLine />}>
                  {t("bulk.apply")}
                </Button>
              </div>
            </form>
          </Popover>
          <Button ref={owner.anchorRef as never} size="xs" variant="ghost" icon={<UserRound />} onClick={owner.toggle} disabled={busy}>
            {t("bulk.assign")}
          </Button>
          <Popover open={owner.open} onClose={owner.close} anchor={owner.anchor}>
            <div className="max-h-72 w-56 overflow-y-auto py-1">
              {users.map((u) => (
                <button key={u.id} type="button" onClick={() => void assign(u)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-100 dark:hover:bg-surface-800">
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto truncate text-2xs text-surface-400">{u.email}</span>
                </button>
              ))}
              <button type="button" onClick={() => void assign(null)} className="flex w-full items-center gap-2 border-t border-surface-100 px-3 py-1.5 text-left text-[13px] text-surface-500 hover:bg-surface-100 dark:border-surface-800 dark:hover:bg-surface-800">
                {t("bulk.unassign")}
              </button>
            </div>
          </Popover>
        </>
      )}
      {canExport && (
        <Button size="xs" variant="ghost" icon={<Download />} onClick={exportSelection}>
          {t("bulk.export")}
        </Button>
      )}
      {canDelete && (
        <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10" icon={<Trash2 />} onClick={() => void remove()}>
          {tc("common.delete")}
        </Button>
      )}
      <span className="mx-1 h-4 w-px bg-surface-200 dark:bg-surface-700" />
      <button type="button" aria-label={t("bulk.clear")} title={t("bulk.clear")} onClick={onClear} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
