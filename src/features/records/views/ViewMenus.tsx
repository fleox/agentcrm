// Toolbar popovers of the object list: sorts, visible columns (reorder
// with dnd-kit, show / hide), view options (layout, group by, pipeline).

import { useTranslation } from "react-i18next";
import { ArrowDownAZ, ArrowUpAZ, Columns3, Eye, EyeOff, GripVertical, Kanban, Plus, Settings2, SlidersHorizontal, Table2, X } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ObjectDef, Pipeline, Sort, ViewDef } from "../../../core/types";
import { Button, IconButton, Popover, Select, usePopover } from "../../../components/ui";
import { cn } from "../../../shared/lib/utils";
import { availableColumns, columnField, groupableFields } from "../lib/viewModel";
import { FieldPickerList } from "./FilterBar";

export function SortMenu({ object, sorts, onChange, readOnly }: { object: ObjectDef; sorts: Sort[]; onChange(s: Sort[]): void; readOnly?: boolean }) {
  const { t } = useTranslation("records");
  const p = usePopover();
  const add = usePopover();
  const fields = availableColumns(object).concat(columnField(object, object.labelField) ?? []);
  return (
    <>
      <Button ref={p.anchorRef as never} size="xs" variant={sorts.length ? "secondary" : "ghost"} icon={<ArrowDownAZ />} onClick={p.toggle}>
        {sorts.length ? t("sorts.count", { count: sorts.length }) : t("sorts.title")}
      </Button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} align="end">
        <div className="w-80 space-y-2 p-3">
          {sorts.length === 0 && <p className="text-xs text-surface-400">{t("sorts.none")}</p>}
          {sorts.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select
                className="min-w-0 flex-1"
                disabled={readOnly}
                aria-label={t("sorts.field")}
                value={s.field}
                onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                options={fields.map((f) => ({ value: f.id, label: f.label }))}
              />
              <IconButton
                size="sm"
                variant="outline"
                disabled={readOnly}
                label={s.dir === "asc" ? t("sorts.asc") : t("sorts.desc")}
                icon={s.dir === "asc" ? <ArrowDownAZ /> : <ArrowUpAZ />}
                onClick={() => onChange(sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)))}
              />
              {!readOnly && <IconButton size="sm" label={t("sorts.remove")} icon={<X />} onClick={() => onChange(sorts.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {!readOnly && (
            <>
              <Button ref={add.anchorRef as never} size="xs" variant="ghost" icon={<Plus />} onClick={add.toggle}>
                {t("sorts.add")}
              </Button>
              <Popover open={add.open} onClose={add.close} anchor={add.anchor}>
                <FieldPickerList
                  fields={fields.filter((f) => !sorts.some((s) => s.field === f.id))}
                  placeholder={t("filters.pickField")}
                  onPick={(f) => {
                    onChange([...sorts, { field: f.id, dir: "asc" }]);
                    add.close();
                  }}
                />
              </Popover>
            </>
          )}
        </div>
      </Popover>
    </>
  );
}

function SortableColumn({ id, label, onHide, locked }: { id: string; label: string; onHide(): void; locked?: boolean }) {
  const { t } = useTranslation("records");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: locked });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex h-8 items-center gap-1.5 rounded px-1 text-[13px] hover:bg-surface-50 dark:hover:bg-surface-800", isDragging && "z-10 bg-white shadow-pop dark:bg-surface-800")}
    >
      <button type="button" aria-label={t("columns.drag", { name: label })} className={cn("cursor-grab text-surface-300 hover:text-surface-500", locked && "invisible")} {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!locked && <IconButton size="xs" label={t("columns.hide", { name: label })} icon={<Eye />} onClick={onHide} />}
    </div>
  );
}

export function FieldsMenu({ object, columns, onChange, readOnly }: { object: ObjectDef; columns: string[]; onChange(cols: string[]): void; readOnly?: boolean }) {
  const { t } = useTranslation("records");
  const p = usePopover();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const shown = columns.filter((c) => c !== object.labelField && !!columnField(object, c));
  const hidden = availableColumns(object).filter((f) => !shown.includes(f.id));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = shown.indexOf(String(e.active.id));
    const to = shown.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(shown, from, to));
  };
  return (
    <>
      <Button ref={p.anchorRef as never} size="xs" variant="ghost" icon={<Columns3 />} onClick={p.toggle}>
        {t("columns.title")}
      </Button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} align="end">
        <div className="w-64 p-2">
          <div className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-surface-400">{t("columns.visible")}</div>
          <SortableColumn id={object.labelField} label={columnField(object, object.labelField)?.label ?? object.labelField} onHide={() => undefined} locked />
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={readOnly ? undefined : onDragEnd}>
            <SortableContext items={shown} strategy={verticalListSortingStrategy}>
              {shown.map((c) => (
                <SortableColumn key={c} id={c} label={columnField(object, c)?.label ?? c} locked={readOnly} onHide={() => onChange(shown.filter((x) => x !== c))} />
              ))}
            </SortableContext>
          </DndContext>
          {hidden.length > 0 && (
            <>
              <div className="mt-2 border-t border-surface-100 px-1 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-surface-400 dark:border-surface-800">{t("columns.hidden")}</div>
              <div className="max-h-56 overflow-y-auto">
                {hidden.map((f) => (
                  <div key={f.id} className="flex h-8 items-center gap-1.5 rounded px-1 text-[13px] text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800">
                    <span className="w-4" />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    {!readOnly && <IconButton size="xs" label={t("columns.show", { name: f.label })} icon={<EyeOff />} onClick={() => onChange([...shown, f.id])} />}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Popover>
    </>
  );
}

export function ViewOptionsMenu({ object, view, pipelines, onChange, readOnly }: { object: ObjectDef; view: ViewDef; pipelines: Pipeline[]; onChange(patch: Partial<ViewDef>): void; readOnly?: boolean }) {
  const { t } = useTranslation("records");
  const p = usePopover();
  const groupable = groupableFields(object);
  const setType = (type: ViewDef["type"]) => {
    if (type === "kanban") {
      const pipeline = pipelines.find((x) => x.id === view.pipelineId) ?? pipelines[0];
      const groupBy = view.groupBy && groupable.some((f) => f.id === view.groupBy) ? view.groupBy : pipeline?.stageField ?? groupable[0]?.id;
      onChange({ type, groupBy, ...(pipeline && groupBy === pipeline.stageField ? { pipelineId: pipeline.id } : {}) });
    } else onChange({ type });
  };
  return (
    <>
      <Button ref={p.anchorRef as never} size="xs" variant="ghost" icon={<SlidersHorizontal />} onClick={p.toggle}>
        {t("options.title")}
      </Button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} align="end">
        <div className="w-72 space-y-3 p-3">
          <div>
            <div className="mb-1 text-xs font-medium text-surface-500">{t("options.layout")}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["table", "kanban"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={readOnly || (type === "kanban" && groupable.length === 0)}
                  onClick={() => setType(type)}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-xs disabled:opacity-40",
                    view.type === type ? "border-accent-500 bg-accent-50 text-accent-800 dark:bg-accent-500/10 dark:text-accent-200" : "border-surface-200 text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800",
                  )}
                >
                  {type === "table" ? <Table2 className="h-4 w-4" /> : <Kanban className="h-4 w-4" />}
                  {t(`options.${type}`)}
                </button>
              ))}
            </div>
            {groupable.length === 0 && <p className="mt-1 text-2xs text-surface-400">{t("options.noGroupable")}</p>}
          </div>
          {view.type === "kanban" && (
            <>
              <div>
                <div className="mb-1 text-xs font-medium text-surface-500">{t("options.groupBy")}</div>
                <Select
                  disabled={readOnly}
                  aria-label={t("options.groupBy")}
                  value={view.groupBy ?? ""}
                  onChange={(e) => {
                    const groupBy = e.target.value;
                    const pipeline = pipelines.find((x) => x.stageField === groupBy);
                    onChange({ groupBy, pipelineId: pipeline ? view.pipelineId ?? pipeline.id : undefined });
                  }}
                  options={groupable.map((f) => ({ value: f.id, label: f.label }))}
                />
              </div>
              {pipelines.length > 0 && pipelines.some((x) => x.stageField === view.groupBy) && (
                <div>
                  <div className="mb-1 text-xs font-medium text-surface-500">{t("options.pipeline")}</div>
                  <Select
                    disabled={readOnly}
                    aria-label={t("options.pipeline")}
                    value={view.pipelineId ?? ""}
                    onChange={(e) => {
                      const pipelineId = e.target.value;
                      // Keep a pipeline filter in sync when the view had one.
                      const filters = view.filters.map((f) => (f.field === "pipeline" && f.op === "eq" ? { ...f, value: pipelineId } : f));
                      onChange({ pipelineId, filters });
                    }}
                    options={pipelines.map((x) => ({ value: x.id, label: x.name }))}
                  />
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-1.5 border-t border-surface-100 pt-2 text-2xs text-surface-400 dark:border-surface-800">
            <Settings2 className="h-3.5 w-3.5" />
            {t("options.hint")}
          </div>
        </div>
      </Popover>
    </>
  );
}
