// Record detail tabs: Notes, Tasks, Related records (inverse relations).

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link2, Plus, Search, StickyNote, Unlink } from "lucide-react";
import { recordLabel } from "../../../core/fields";
import type { CrmRecord, ObjectDef } from "../../../core/types";
import { Button, EmptyState, FieldValue, IconButton, Popover, RecordAvatar, useFieldContext, usePopover } from "../../../components/ui";
import { useActivities, useCan, useCollection, useOps } from "../../../app/CrmDataContext";
import { paths } from "../../../app/paths";
import { emitShellEvent } from "../../../app/shellEvents";
import { linkRecords, unlinkRecords, type InverseRelation } from "../../../ops/relations";
import { TaskList } from "../../tasks/TaskList";
import { toast } from "../../../shared/lib/toast";
import { cn } from "../../../shared/lib/utils";
import { ActivityComposer } from "./ActivityComposer";
import { ActivityItem } from "./Timeline";

export function NotesTab({ record, object }: { record: CrmRecord; object: ObjectDef }) {
  const { t } = useTranslation("records");
  const activities = useActivities(record.id);
  const notes = activities.filter((a) => a.type === "note");
  return (
    <div className="space-y-3" data-testid="notes-tab">
      <ActivityComposer targets={[{ object: object.id, id: record.id }]} defaultType="note" types={["note"]} />
      {notes.length === 0 ? (
        <EmptyState icon={<StickyNote />} title={t("notes.empty")} description={t("notes.emptyHint")} />
      ) : (
        <ul>
          {notes.map((n) => (
            <ActivityItem key={n.id} activity={n} record={record} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TasksTab({ record, object }: { record: CrmRecord; object: ObjectDef }) {
  const { t } = useTranslation("records");
  const activities = useActivities(record.id);
  const canWrite = useCan("activities.write");
  const tasks = activities.filter((a) => a.type === "task");
  return (
    <div className="space-y-3" data-testid="tasks-tab">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" icon={<Plus />} onClick={() => emitShellEvent("tasks.create", { targets: [{ object: object.id, id: record.id }] })}>
            {t("tasks.new")}
          </Button>
        </div>
      )}
      <TaskList tasks={tasks} emptyText={t("tasks.empty")} />
    </div>
  );
}

function LinkPicker({ inv, record, onPick }: { inv: InverseRelation; record: CrmRecord; onPick(id: string): void }) {
  const { t } = useTranslation("records");
  const ctx = useFieldContext();
  const [q, setQ] = useState("");
  const linked = new Set(inv.records.map((r) => r.id));
  const results = ctx.searchRecords(inv.object, q, 30).filter((r) => !linked.has(r.id) && r.id !== record.id);
  return (
    <div className="w-72">
      <div className="flex items-center gap-2 border-b border-surface-100 px-2.5 dark:border-surface-800">
        <Search className="h-4 w-4 text-surface-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("related.search", { object: inv.label.toLowerCase() })} className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-surface-400" />
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {results.length === 0 && <div className="px-3 py-2 text-sm text-surface-400">{t("related.noMatch")}</div>}
        {results.map((r) => (
          <button key={r.id} type="button" onClick={() => onPick(r.id)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-100 dark:hover:bg-surface-800">
            <RecordAvatar recordId={r.id} name={r.label} size="sm" square={inv.object === "companies"} />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.sub && <span className="truncate text-2xs text-surface-400">{r.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RelatedTab({ record, inv }: { record: CrmRecord; inv: InverseRelation }) {
  const { t } = useTranslation("records");
  const ops = useOps();
  const navigate = useNavigate();
  const canWrite = useCan("records.write");
  const objects = useCollection<ObjectDef>("objects");
  const records = useCollection<CrmRecord>("records");
  const p = usePopover();
  const object = objects.find((o) => o.id === inv.object);
  const field = object?.fields.find((f) => f.id === inv.field);
  const many = field?.relation?.cardinality === "many";
  const rows = useMemo(() => {
    const byId = new Map(records.map((r) => [r.id, r]));
    return inv.records.map((r) => byId.get(r.id)).filter((r): r is CrmRecord => !!r);
  }, [inv.records, records]);
  const cols = useMemo(() => (object ? object.fields.filter((f) => !f.hidden && f.id !== object.labelField && f.id !== inv.field && f.type !== "longText" && f.type !== "address").slice(0, 3) : []), [object, inv.field]);
  if (!object || !field) return null;

  const link = async (id: string) => {
    p.close();
    try {
      await linkRecords(ops, id, inv.field, record.id);
      toast.success(t("related.linked"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const unlink = async (id: string) => {
    try {
      await unlinkRecords(ops, id, inv.field, record.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3" data-testid={`related-${inv.object}-${inv.field}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-surface-500">{t("related.via", { object: object.labelPlural, field: field.label })}</span>
        {canWrite && (
          <div className="ml-auto flex gap-1.5">
            <Button ref={p.anchorRef as never} size="xs" icon={<Link2 />} onClick={p.toggle}>
              {t("related.link")}
            </Button>
            <Popover open={p.open} onClose={p.close} anchor={p.anchor} align="end">
              <LinkPicker inv={inv} record={record} onPick={(id) => void link(id)} />
            </Popover>
            <Button size="xs" variant="primary" icon={<Plus />} onClick={() => emitShellEvent("record.create", { object: object.id, defaults: { [inv.field]: many ? [record.id] : record.id } })}>
              {t("related.new", { object: object.labelSingular })}
            </Button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("related.empty", { object: object.labelPlural.toLowerCase() })} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="h-8 border-b border-surface-200 px-3 text-left text-xs font-medium text-surface-500 dark:border-surface-800">{object.fields.find((f) => f.id === object.labelField)?.label}</th>
                {cols.map((c) => (
                  <th key={c.id} className="h-8 border-b border-surface-200 px-3 text-left text-xs font-medium text-surface-500 dark:border-surface-800">
                    {c.label}
                  </th>
                ))}
                <th className="w-10 border-b border-surface-200 dark:border-surface-800" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="group hover:bg-surface-50 dark:hover:bg-surface-900">
                  <td className="h-9 border-b border-surface-100 px-3 dark:border-surface-800/70">
                    <button type="button" onClick={() => navigate(paths.record(object.id, r.id))} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                      <RecordAvatar recordId={r.id} name={recordLabel(object, r)} size="sm" square={object.id === "companies"} />
                      <span className="truncate">{recordLabel(object, r)}</span>
                    </button>
                  </td>
                  {cols.map((c) => (
                    <td key={c.id} className="h-9 max-w-[220px] truncate border-b border-surface-100 px-3 dark:border-surface-800/70">
                      <FieldValue field={c} value={r.fields[c.id]} compact />
                    </td>
                  ))}
                  <td className="border-b border-surface-100 pr-2 text-right dark:border-surface-800/70">
                    {canWrite && <IconButton size="xs" label={t("related.unlink")} icon={<Unlink />} className={cn("opacity-0 group-hover:opacity-100 focus:opacity-100")} onClick={() => void unlink(r.id)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
