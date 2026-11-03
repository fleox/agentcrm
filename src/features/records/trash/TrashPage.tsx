// Deleted records of an object (soft delete): restore, and permanent
// deletion for admins (also purges activities that only target them).

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { recordLabel } from "../../../core/fields";
import type { CrmRecord } from "../../../core/types";
import { Avatar, Button, Checkbox, confirmDialog, EmptyState, ObjectIcon, useFieldContext } from "../../../components/ui";
import { useCan, useObject, useOps, useRecords } from "../../../app/CrmDataContext";
import { useAuth } from "../../../app/AuthContext";
import { paths } from "../../../app/paths";
import { bulkDelete, deleteRecord, restoreRecord } from "../../../ops/records";
import { toast } from "../../../shared/lib/toast";
import { formatDateTime } from "../../../shared/lib/utils";

export function TrashPage() {
  const { objectId = "" } = useParams();
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const navigate = useNavigate();
  const ctx = useFieldContext();
  const { isAdmin } = useAuth();
  const object = useObject(objectId);
  const all = useRecords(objectId, { includeDeleted: true });
  const canRestore = useCan("records.write");
  const canHard = useCan("records.delete") && isAdmin;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const deleted = useMemo(() => all.filter((r) => r.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)), [all]);
  if (!object) return <EmptyState className="py-24" title={t("list.unknownObject")} />;

  const ids = deleted.filter((r) => selected.has(r.id)).map((r) => r.id);
  const restore = async (list: string[]) => {
    try {
      for (const id of list) await restoreRecord(ops, id);
      toast.success(t("trash.restoredCount", { count: list.length }));
      setSelected(new Set());
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const purge = async (list: string[]) => {
    if (!(await confirmDialog({ title: t("trash.purgeTitle", { count: list.length }), description: tc("confirm.irreversible"), danger: true, confirmLabel: t("trash.hardDelete") }))) return;
    try {
      if (list.length === 1) await deleteRecord(ops, list[0], { hard: true });
      else await bulkDelete(ops, list, { hard: true });
      toast.success(t("trash.purged", { count: list.length }));
      setSelected(new Set());
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const users = ctx.users;
  const who = (r: CrmRecord) => users.find((u) => u.id === r.updatedBy)?.name;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-200 px-5 dark:border-surface-800">
        <Link to={paths.objectList(object.id)} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800" aria-label={t("detail.back", { object: object.labelPlural })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Trash2 className="h-4 w-4 text-surface-500" />
        <h1 className="text-[15px] font-semibold">{t("trash.title", { object: object.labelPlural })}</h1>
        <span className="rounded bg-surface-100 px-1.5 text-xs text-surface-500 dark:bg-surface-800">{deleted.length}</span>
        <div className="ml-auto flex gap-1.5">
          {ids.length > 0 && canRestore && (
            <Button size="sm" icon={<RotateCcw />} onClick={() => void restore(ids)}>
              {t("trash.restoreSelected", { count: ids.length })}
            </Button>
          )}
          {canHard && deleted.length > 0 && (
            <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => void purge(ids.length ? ids : deleted.map((r) => r.id))}>
              {ids.length ? t("trash.purgeSelected", { count: ids.length }) : t("trash.empty")}
            </Button>
          )}
        </div>
      </header>
      {deleted.length === 0 ? (
        <EmptyState className="py-24" icon={<Trash2 />} title={t("trash.nothing")} description={t("trash.nothingHint")} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="px-5 py-2 text-xs text-surface-500">{t("trash.hint")}</p>
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 bg-white dark:bg-surface-950">
              <tr>
                <th className="w-10 border-b border-surface-200 px-3 dark:border-surface-800">
                  <Checkbox aria-label={t("table.selectAll")} checked={ids.length === deleted.length} indeterminate={ids.length > 0 && ids.length < deleted.length} onChange={() => setSelected(ids.length === deleted.length ? new Set() : new Set(deleted.map((r) => r.id)))} />
                </th>
                <th className="h-8 border-b border-surface-200 px-2 text-left text-xs font-medium text-surface-500 dark:border-surface-800">{object.labelSingular}</th>
                <th className="h-8 border-b border-surface-200 px-2 text-left text-xs font-medium text-surface-500 dark:border-surface-800">{t("trash.deletedAt")}</th>
                <th className="w-48 border-b border-surface-200 dark:border-surface-800" />
              </tr>
            </thead>
            <tbody>
              {deleted.map((r) => (
                <tr key={r.id} className="group hover:bg-surface-50 dark:hover:bg-surface-900">
                  <td className="border-b border-surface-100 px-3 dark:border-surface-800/70">
                    <Checkbox aria-label={recordLabel(object, r)} checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />
                  </td>
                  <td className="h-9 border-b border-surface-100 px-2 dark:border-surface-800/70">
                    <button type="button" className="flex items-center gap-2 text-surface-600 hover:underline dark:text-surface-300" onClick={() => navigate(paths.record(object.id, r.id))}>
                      <Avatar name={recordLabel(object, r)} size="sm" square={object.id === "companies"} />
                      {recordLabel(object, r)}
                    </button>
                  </td>
                  <td className="border-b border-surface-100 px-2 text-xs text-surface-500 dark:border-surface-800/70">
                    {formatDateTime(r.deletedAt!, ctx.locale)}
                    {who(r) ? ` · ${who(r)}` : ""}
                  </td>
                  <td className="border-b border-surface-100 px-2 text-right dark:border-surface-800/70">
                    <span className="inline-flex gap-1">
                      {canRestore && (
                        <Button size="xs" icon={<RotateCcw />} onClick={() => void restore([r.id])}>
                          {t("trash.restore")}
                        </Button>
                      )}
                      {canHard && (
                        <Button size="xs" variant="ghost" className="text-red-600 dark:text-red-400" icon={<Trash2 />} onClick={() => void purge([r.id])}>
                          {t("trash.hardDelete")}
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span hidden>
        <ObjectIcon name={object.icon} />
      </span>
    </div>
  );
}
