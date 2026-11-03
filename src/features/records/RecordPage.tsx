// Record detail page: header (editable label, owner, actions), fields
// panel, and tabs — Timeline, Notes, Tasks, one tab per related object
// (inverse relations) and tabs / panels / actions contributed by other
// features through the record detail slots.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckSquare, ChevronRight, Clock, GitMerge, Link2, MoreHorizontal, Plus, RotateCcw, StickyNote, Trash2 } from "lucide-react";
import { recordLabel } from "../../core/fields";
import type { ActivityType, CrmRecord, ObjectDef } from "../../core/types";
import { Avatar, Button, confirmDialog, Dropdown, EmptyState, ObjectIcon, Tabs, useFieldContext } from "../../components/ui";
import { useActivities, useCan, useCollection, useObject, useOps, useRecord } from "../../app/CrmDataContext";
import { useAuth } from "../../app/AuthContext";
import { useSlot } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import { emitShellEvent } from "../../app/shellEvents";
import { deleteRecord, restoreRecord, updateRecord } from "../../ops/records";
import { inverseRelations } from "../../ops/relations";
import { toast } from "../../shared/lib/toast";
import { cn, formatRelative } from "../../shared/lib/utils";
import { ACTIVITY_ICONS } from "./detail/activityStyle";
import { FieldsPanel } from "./detail/FieldsPanel";
import { MergeModal } from "./detail/MergeModal";
import { NotesTab, RelatedTab, TasksTab } from "./detail/Tabs";
import { Timeline } from "./detail/Timeline";

function LabelEditor({ record, object, canWrite }: { record: CrmRecord; object: ObjectDef; canWrite: boolean }) {
  const { t } = useTranslation("records");
  const ops = useOps();
  const [editing, setEditing] = useState(false);
  const label = recordLabel(object, record);
  const [value, setValue] = useState(label);
  const save = async () => {
    setEditing(false);
    const next = value.trim();
    if (!next || next === label) return;
    try {
      await updateRecord(ops, record.id, { [object.labelField]: next });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={t("detail.rename")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setValue(label);
            setEditing(false);
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-md border border-accent-500 bg-white px-2 text-lg font-semibold outline-none dark:bg-surface-900"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!canWrite}
      onClick={() => {
        setValue(label);
        setEditing(true);
      }}
      title={canWrite ? t("detail.rename") : undefined}
      className={cn("min-w-0 truncate rounded-md px-1 text-left text-lg font-semibold text-surface-900 dark:text-white", canWrite && "hover:bg-surface-100 dark:hover:bg-surface-800")}
    >
      <h1 className="truncate">{label}</h1>
    </button>
  );
}

export function RecordPage() {
  const { objectId = "", recordId = "" } = useParams();
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ops = useOps();
  const ctx = useFieldContext();
  const { isAdmin } = useAuth();
  const object = useObject(objectId);
  const record = useRecord(recordId);
  const activities = useActivities(recordId);
  const allRecords = useCollection("records");
  const tabSlot = useSlot("recordDetailTabs");
  const panelSlot = useSlot("recordDetailPanels");
  const actionSlot = useSlot("recordActions");
  const objects = useCollection("objects");
  const canWrite = useCan("records.write");
  const canDelete = useCan("records.delete");
  const canLog = useCan("activities.write");
  const [merging, setMerging] = useState(false);

  const inverse = useMemo(() => (record ? inverseRelations(ops, record) : []), [ops, record, allRecords, objects]);

  if (!object || !record || record.object !== object.id) {
    return (
      <EmptyState
        className="py-24"
        title={t("detail.notFound")}
        description={t("detail.notFoundHint")}
        action={
          object && (
            <Button icon={<ArrowLeft />} onClick={() => navigate(paths.objectList(object.id))}>
              {t("detail.back", { object: object.labelPlural })}
            </Button>
          )
        }
      />
    );
  }

  const label = recordLabel(object, record);
  const deleted = !!record.deletedAt;
  const slotProps = { record, object };
  const slotTabs = tabSlot.filter((x) => !x.when || x.when(object));
  const panels = panelSlot.filter((x) => !x.when || x.when(object));
  const actions = actionSlot.filter((x) => !x.when || x.when(object));
  const notes = activities.filter((a) => a.type === "note").length;
  const openTasks = activities.filter((a) => a.type === "task" && !a.doneAt).length;

  const tabs = [
    { id: "timeline", label: t("detail.timeline"), icon: <Clock />, count: activities.length || undefined },
    { id: "notes", label: t("detail.notes"), icon: <StickyNote />, count: notes || undefined },
    { id: "tasks", label: t("detail.tasks"), icon: <CheckSquare />, count: openTasks || undefined },
    ...inverse.map((inv) => ({
      id: `rel:${inv.object}:${inv.field}`,
      label: inverse.filter((x) => x.object === inv.object).length > 1 ? `${inv.label} (${inv.fieldLabel})` : inv.label,
      icon: <ObjectIcon name={(objects as unknown as ObjectDef[]).find((o) => o.id === inv.object)?.icon} />,
      count: inv.records.length,
    })),
    ...slotTabs.map((x) => ({ id: `slot:${x.id}`, label: tc(x.label), icon: x.icon ? <x.icon /> : undefined })),
  ];
  const tab = tabs.some((x) => x.id === params.get("tab")) ? params.get("tab")! : "timeline";
  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === "timeline") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  };

  const SlotTab = tab.startsWith("slot:") ? slotTabs.find((x) => `slot:${x.id}` === tab)?.component : undefined;
  const inv = tab.startsWith("rel:") ? inverse.find((x) => `rel:${x.object}:${x.field}` === tab) : undefined;

  const remove = async () => {
    if (!(await confirmDialog({ title: tc("confirm.deleteTitle", { name: label }), description: t("detail.deleteHint"), danger: true, confirmLabel: tc("common.delete") }))) return;
    try {
      await deleteRecord(ops, record.id);
      toast.success(t("detail.deletedToast", { name: label }));
      navigate(paths.objectList(object.id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const hardDelete = async () => {
    if (!(await confirmDialog({ title: t("trash.hardDeleteTitle", { name: label }), description: tc("confirm.irreversible"), danger: true, confirmLabel: t("trash.hardDelete") }))) return;
    try {
      await deleteRecord(ops, record.id, { hard: true });
      navigate(`/objects/${object.id}/trash`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const restore = async () => {
    try {
      await restoreRecord(ops, record.id);
      toast.success(t("trash.restored", { name: label }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${paths.record(object.id, record.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tc("common.copied"));
    } catch {
      toast.info(url);
    }
  };
  const log = (type: ActivityType) => (type === "task" ? emitShellEvent("tasks.create", { targets: [{ object: object.id, id: record.id }] }) : emitShellEvent("activity.log", { type, target: { object: object.id, id: record.id } }));

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="shrink-0 border-b border-surface-200 bg-white px-4 py-2 dark:border-surface-800 dark:bg-surface-950 sm:px-5">
        <nav className="flex items-center gap-1 text-xs text-surface-500" aria-label={t("detail.breadcrumb")}>
          <Link to={paths.objectList(object.id)} className="inline-flex items-center gap-1 hover:text-surface-800 dark:hover:text-surface-200">
            <ObjectIcon name={object.icon} color={object.color} />
            {object.labelPlural}
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="truncate">{label}</span>
        </nav>
        <div className="mt-1 flex items-center gap-2">
          <Avatar name={label} size="lg" square={object.id === "companies"} />
          <div className="min-w-0 flex-1">
            <LabelEditor record={record} object={object} canWrite={canWrite && !deleted} />
            <div className="flex flex-wrap items-center gap-x-2 px-1 text-2xs text-surface-400">
              <span>{object.labelSingular}</span>
              <span>· {t("detail.updatedAgo", { when: formatRelative(record.updatedAt, ctx.locale) })}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions.map((a) =>
              a.component ? (
                <a.component key={a.id} {...slotProps} />
              ) : (
                <Button key={a.id} size="sm" icon={a.icon ? <a.icon /> : undefined} onClick={() => a.onSelect?.(slotProps)}>
                  {tc(a.label)}
                </Button>
              ),
            )}
            {canLog && !deleted && (
              <Dropdown
                align="end"
                trigger={({ ref, onClick }) => (
                  <Button ref={ref as never} size="sm" icon={<Plus />} onClick={onClick}>
                    {t("detail.log")}
                  </Button>
                )}
                items={(["note", "call", "email", "meeting", "task"] as ActivityType[]).map((ty) => {
                  const Icon = ACTIVITY_ICONS[ty];
                  return { id: ty, label: tc(`activityTypes.${ty}`), icon: <Icon />, onSelect: () => log(ty) };
                })}
              />
            )}
            <Dropdown
              align="end"
              trigger={({ ref, onClick }) => (
                <Button ref={ref as never} size="sm" variant="ghost" aria-label={t("detail.actions")} icon={<MoreHorizontal />} onClick={onClick} />
              )}
              items={[
                { id: "copy", label: t("detail.copyLink"), icon: <Link2 />, onSelect: () => void copyLink() },
                ...(canWrite && canDelete && !deleted ? [{ id: "merge", label: t("detail.merge"), icon: <GitMerge />, onSelect: () => setMerging(true) }] : []),
                ...(deleted
                  ? [
                      ...(canWrite ? [{ id: "restore", label: t("trash.restore"), icon: <RotateCcw />, separator: true, onSelect: () => void restore() }] : []),
                      ...(canDelete && isAdmin ? [{ id: "hard", label: t("trash.hardDelete"), icon: <Trash2 />, danger: true, onSelect: () => void hardDelete() }] : []),
                    ]
                  : canDelete
                    ? [{ id: "delete", label: t("detail.delete"), icon: <Trash2 />, danger: true, separator: true, onSelect: () => void remove() }]
                    : []),
              ]}
            />
          </div>
        </div>
      </header>
      {deleted && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200" role="status">
          <Trash2 className="h-4 w-4" />
          <span className="flex-1">{t("detail.deleted")}</span>
          {canWrite && (
            <Button size="xs" icon={<RotateCcw />} onClick={() => void restore()}>
              {t("trash.restore")}
            </Button>
          )}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(320px,380px)_1fr] lg:overflow-hidden">
        <aside className="border-b border-surface-200 p-4 dark:border-surface-800 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <FieldsPanel record={record} object={object} />
          {panels.length > 0 && (
            <div className="mt-4 space-y-3">
              {panels.map((p) => (
                <p.component key={p.id} {...slotProps} />
              ))}
            </div>
          )}
        </aside>
        <section className="min-w-0 lg:overflow-y-auto">
          <Tabs className="sticky top-0 z-10 bg-white px-4 dark:bg-surface-950" tabs={tabs} value={tab} onChange={setTab} />
          <div className="mx-auto max-w-3xl p-4">
            {tab === "timeline" && <Timeline record={record} object={object} />}
            {tab === "notes" && <NotesTab record={record} object={object} />}
            {tab === "tasks" && <TasksTab record={record} object={object} />}
            {inv && <RelatedTab record={record} inv={inv} />}
            {SlotTab && <SlotTab {...slotProps} />}
          </div>
        </section>
      </div>
      <MergeModal open={merging} onClose={() => setMerging(false)} record={record} object={object} />
    </div>
  );
}
