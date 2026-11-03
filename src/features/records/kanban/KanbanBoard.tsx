// Kanban view: columns from pipeline stages (deals) or any select / user /
// checkbox field; drag & drop between columns (pipelines → moveStage with
// won / lost confirmation) and inside a column (manual order, kept per
// browser); column totals (count, amount, weighted forecast); quick add.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, MoreHorizontal, Plus, Trophy, XCircle } from "lucide-react";
import { formatCurrency, recordLabel } from "../../../core/fields";
import type { CrmRecord, FieldDef, Filter, ObjectDef, Pipeline, ViewDef } from "../../../core/types";
import { Avatar, Badge, Button, confirmDialog, dotClass, Dropdown, EmptyState, FieldValue, FormField, Input, Modal, useFieldContext } from "../../../components/ui";
import { useOps, useSettings, useUsers } from "../../../app/CrmDataContext";
import { createRecord, updateRecord } from "../../../ops/records";
import { moveStage } from "../../../ops/pipelines";
import { toast } from "../../../shared/lib/toast";
import { cn } from "../../../shared/lib/utils";
import { useLocalState } from "../lib/hooks";
import { amountField, applyManualOrder, columnField, columnTotals, defaultsFromFilters, kanbanColumns, kanbanKeyOf, kanbanValueOf, type KanbanColumnDef } from "../lib/viewModel";

const LOST_REASONS = ["price", "competitor", "budget", "timing", "noDecision", "other"] as const;

export function LostReasonModal({ open, label, onCancel, onConfirm }: { open: boolean; label: string; onCancel(): void; onConfirm(reason: string): void }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={onCancel} size="sm" title={t("kanban.lostTitle", { name: label })} description={t("kanban.lostHint")}>
      <form
        data-form-type="other"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason.trim());
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {LOST_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(t(`kanban.reasons.${r}`))}
              className={cn("rounded-full border px-2 py-0.5 text-xs", reason === t(`kanban.reasons.${r}`) ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "border-surface-200 text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300")}
            >
              {t(`kanban.reasons.${r}`)}
            </button>
          ))}
        </div>
        <FormField label={t("kanban.lostReason")} htmlFor="lost-reason">
          <Input id="lost-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {tc("common.cancel")}
          </Button>
          <Button type="submit" variant="danger" icon={<XCircle />}>
            {t("kanban.markLost")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface CardProps {
  record: CrmRecord;
  object: ObjectDef;
  fields: FieldDef[];
  columns: KanbanColumnDef[];
  currentKey: string;
  canWrite: boolean;
  onOpen(): void;
  onMove(toKey: string): void;
  overlay?: boolean;
}

function CardBody({ record, object, fields, columns, currentKey, canWrite, onOpen, onMove }: CardProps) {
  const { t } = useTranslation("records");
  const ctx = useFieldContext();
  const owner = ctx.users.find((u) => u.id === record.ownerId);
  const label = recordLabel(object, record);
  return (
    <>
      <div className="flex items-start gap-1.5">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-surface-900 hover:underline dark:text-white">
          {label}
        </button>
        {canWrite && (
          <Dropdown
            align="end"
            trigger={({ ref, onClick }) => (
              <button
                ref={ref as never}
                type="button"
                aria-label={t("kanban.cardMenu", { name: label })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClick}
                className="-mr-1 -mt-0.5 rounded p-0.5 text-surface-400 opacity-0 hover:bg-surface-100 hover:text-surface-700 focus:opacity-100 group-hover/card:opacity-100 dark:hover:bg-surface-800"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
            items={columns
              .filter((c) => c.key !== currentKey)
              .map((c) => ({ id: `move-${c.key || "none"}`, label: t("kanban.moveTo", { column: c.label }), icon: <ArrowRight />, onSelect: () => onMove(c.key) }))}
          />
        )}
      </div>
      {fields.length > 0 && (
        <dl className="mt-1.5 space-y-1">
          {fields.map((f) => {
            const v = f.id === "ownerId" ? record.ownerId : record.fields[f.id];
            return (
              <div key={f.id} className="flex min-w-0 items-center gap-2 text-xs">
                <dt className="w-20 shrink-0 truncate text-surface-400">{f.label}</dt>
                <dd className="min-w-0 flex-1 truncate text-surface-700 dark:text-surface-200">
                  <FieldValue field={f} value={v} compact emptyText="—" />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {owner && (
        <div className="mt-2 flex justify-end">
          <span title={owner.name}>
            <Avatar name={owner.name} src={owner.avatarUrl} size="sm" />
          </span>
        </div>
      )}
    </>
  );
}

function SortableCard(props: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.record.id, disabled: !props.canWrite, data: { column: props.currentKey } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-card-id={props.record.id}
      className={cn(
        "group/card rounded-lg border border-surface-200 bg-white p-2.5 shadow-card transition-shadow hover:border-surface-300 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700",
        isDragging && "opacity-40",
        props.canWrite && "cursor-grab active:cursor-grabbing",
      )}
      {...attributes}
      {...listeners}
    >
      <CardBody {...props} />
    </div>
  );
}

function Column({
  column,
  records,
  object,
  fields,
  columns,
  amount,
  canWrite,
  onOpen,
  onMove,
  onQuickAdd,
}: {
  column: KanbanColumnDef;
  records: CrmRecord[];
  object: ObjectDef;
  fields: FieldDef[];
  columns: KanbanColumnDef[];
  amount: FieldDef | undefined;
  canWrite: boolean;
  onOpen(r: CrmRecord): void;
  onMove(r: CrmRecord, toKey: string): void;
  onQuickAdd(label: string): Promise<void>;
}) {
  const { t } = useTranslation("records");
  const settings = useSettings();
  const ctx = useFieldContext();
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}`, data: { column: column.key } });
  const totals = columnTotals(records, amount, column.stage);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const money = (n: number) => formatCurrency(n, amount?.currency ?? settings.defaultCurrency, ctx.locale, true);
  return (
    <section
      aria-label={column.label}
      data-column={column.key}
      className={cn("flex h-full w-[280px] shrink-0 flex-col rounded-lg bg-surface-50 transition-colors dark:bg-surface-900/60", isOver && "bg-accent-50 ring-1 ring-accent-300 dark:bg-accent-500/10 dark:ring-accent-500/40")}
    >
      <header className="shrink-0 px-2.5 pb-1.5 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(column.color))} />
          <h3 className="min-w-0 truncate text-[13px] font-semibold text-surface-800 dark:text-surface-100">{column.label}</h3>
          {column.stage?.kind === "won" && <Trophy className="h-3.5 w-3.5 text-emerald-500" />}
          <span className="rounded bg-surface-200/70 px-1.5 text-2xs font-medium tabular-nums text-surface-600 dark:bg-surface-800 dark:text-surface-300">{totals.count}</span>
          {column.stage && <span className="ml-auto text-2xs tabular-nums text-surface-400">{column.stage.probability}%</span>}
        </div>
        {amount && (
          <div className="mt-1 flex items-center gap-2 text-2xs tabular-nums text-surface-500" data-testid={`totals-${column.key}`}>
            <span>{money(totals.amount)}</span>
            {column.stage && column.stage.kind === "open" && (
              <span title={t("kanban.weighted")} className="text-surface-400">
                · {t("kanban.weightedShort")} {money(totals.weighted)}
              </span>
            )}
          </div>
        )}
      </header>
      <div ref={setNodeRef} className="min-h-[60px] flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">
        <SortableContext items={records.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {records.map((r) => (
            <SortableCard key={r.id} record={r} object={object} fields={fields} columns={columns} currentKey={column.key} canWrite={canWrite} onOpen={() => onOpen(r)} onMove={(k) => onMove(r, k)} />
          ))}
        </SortableContext>
        {canWrite &&
          (adding ? (
            <form
              data-form-type="other"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!label.trim()) return;
                await onQuickAdd(label.trim());
                setLabel("");
              }}
            >
              <input
                autoFocus
                value={label}
                aria-label={t("kanban.quickAdd", { column: column.label })}
                placeholder={columnField(object, object.labelField)?.label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => !label && setAdding(false)}
                onKeyDown={(e) => e.key === "Escape" && (setAdding(false), setLabel(""))}
                className="h-8 w-full rounded-md border border-accent-500 bg-white px-2 text-[13px] outline-none dark:bg-surface-900"
              />
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[13px] text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200">
              <Plus className="h-3.5 w-3.5" />
              {t("kanban.new")}
            </button>
          ))}
      </div>
    </section>
  );
}

export function KanbanBoard({ object, view, records, pipelines, canWrite, filters, onOpen }: { object: ObjectDef; view: ViewDef; records: CrmRecord[]; pipelines: Pipeline[]; canWrite: boolean; filters: Filter[]; onOpen(r: CrmRecord): void }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const users = useUsers();
  const groupField = object.fields.find((f) => f.id === view.groupBy);
  const pipeline = groupField ? pipelines.find((p) => p.id === view.pipelineId && p.stageField === groupField.id) ?? pipelines.find((p) => p.stageField === groupField.id) : undefined;
  const columns = useMemo(
    () => (groupField ? kanbanColumns(groupField, { pipeline, users, noValueLabel: t("kanban.noValue"), yes: tc("common.yes"), no: tc("common.no") }) : []),
    [groupField, pipeline, users, t, tc],
  );
  const [order, setOrder] = useLocalState<Record<string, string[]>>(`agentcrm.kanbanOrder.${view.id}`, {});
  const [lost, setLost] = useState<{ record: CrmRecord; resolve(reason: string | null): void } | null>(null);
  const [dragging, setDragging] = useState<CrmRecord | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const amount = amountField(object);
  const cardFields = useMemo(
    () =>
      view.columns
        .filter((c) => c !== object.labelField && c !== view.groupBy)
        .map((c) => columnField(object, c))
        .filter((f): f is FieldDef => !!f)
        .slice(0, 4),
    [view.columns, view.groupBy, object],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CrmRecord[]>(columns.map((c) => [c.key, []]));
    if (!groupField) return map;
    for (const r of records) {
      const key = kanbanKeyOf(r, groupField);
      map.get(key)?.push(r);
    }
    for (const [k, list] of map) map.set(k, applyManualOrder(list, order[k]));
    return map;
  }, [records, groupField, columns, order]);

  if (!groupField) return <EmptyState className="py-24" title={t("kanban.noGroup")} description={t("kanban.noGroupHint")} />;

  const askLostReason = (record: CrmRecord) => new Promise<string | null>((resolve) => setLost({ record, resolve }));

  const move = async (record: CrmRecord, toKey: string): Promise<boolean> => {
    const from = kanbanKeyOf(record, groupField);
    if (from === toKey) return true;
    const label = recordLabel(object, record);
    try {
      if (pipeline) {
        const stage = pipeline.stages.find((s) => s.id === toKey);
        if (!stage) return false;
        if (stage.kind === "lost") {
          const reason = await askLostReason(record);
          if (reason === null) return false;
          await moveStage(ops, record.id, stage.id, { lostReason: reason || undefined });
        } else if (stage.kind === "won") {
          if (!(await confirmDialog({ title: t("kanban.wonTitle", { name: label }), description: t("kanban.wonHint"), confirmLabel: t("kanban.markWon") }))) return false;
          await moveStage(ops, record.id, stage.id);
          toast.success(t("kanban.wonToast", { name: label }));
        } else {
          await moveStage(ops, record.id, stage.id);
        }
      } else {
        await updateRecord(ops, record.id, { [groupField.id]: kanbanValueOf(groupField, toKey) });
      }
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };

  const columnOf = (id: string): string | undefined => {
    for (const [k, list] of grouped) if (list.some((r) => r.id === id)) return k;
    return undefined;
  };

  const onDragStart = (e: DragStartEvent) => setDragging(records.find((r) => r.id === e.active.id) ?? null);

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const from = columnOf(id);
    const overId = String(over.id);
    const to = overId.startsWith("col:") ? overId.slice(4) : columnOf(overId);
    if (from === undefined || to === undefined) return;
    const target = (grouped.get(to) ?? []).map((r) => r.id);
    if (from === to) {
      const oldIndex = target.indexOf(id);
      const newIndex = overId.startsWith("col:") ? target.length - 1 : target.indexOf(overId);
      if (oldIndex === newIndex || newIndex < 0) return;
      setOrder((o) => ({ ...o, [to]: arrayMove(target, oldIndex, newIndex) }));
      return;
    }
    const record = records.find((r) => r.id === id);
    if (!record) return;
    const ok = await move(record, to);
    if (!ok) return;
    const index = overId.startsWith("col:") ? target.length : Math.max(0, target.indexOf(overId));
    const next = target.filter((x) => x !== id);
    next.splice(index, 0, id);
    setOrder((o) => ({ ...o, [to]: next, [from]: (o[from] ?? []).filter((x) => x !== id) }));
  };

  const quickAdd = async (column: KanbanColumnDef, label: string) => {
    try {
      await createRecord(ops, object.id, { ...defaultsFromFilters(object, filters), [object.labelField]: label, [groupField.id]: kanbanValueOf(groupField, column.key) ?? undefined, ...(pipeline && object.fields.some((f) => f.id === "pipeline") ? { pipeline: pipeline.id } : {}) });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3" data-testid="kanban">
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={() => setDragging(null)}>
        <div className="flex h-full gap-2.5">
          {columns.map((c) => (
            <Column
              key={c.key || "none"}
              column={c}
              records={grouped.get(c.key) ?? []}
              object={object}
              fields={cardFields}
              columns={columns}
              amount={amount}
              canWrite={canWrite}
              onOpen={onOpen}
              onMove={(r, k) => void move(r, k)}
              onQuickAdd={(label) => quickAdd(c, label)}
            />
          ))}
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="w-[268px] rotate-2 rounded-lg border border-surface-200 bg-white p-2.5 shadow-pop dark:border-surface-700 dark:bg-surface-900">
              <CardBody record={dragging} object={object} fields={cardFields} columns={columns} currentKey="" canWrite={false} onOpen={() => undefined} onMove={() => undefined} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {lost && (
        <LostReasonModal
          open
          label={recordLabel(object, lost.record)}
          onCancel={() => {
            lost.resolve(null);
            setLost(null);
          }}
          onConfirm={(reason) => {
            lost.resolve(reason);
            setLost(null);
          }}
        />
      )}
      {pipeline && <span className="sr-only">{pipeline.name}</span>}
      <Badge className="hidden">{columns.length}</Badge>
    </div>
  );
}
