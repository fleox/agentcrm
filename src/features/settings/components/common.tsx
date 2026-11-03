// Small building blocks shared by the settings sections (kept inside the
// feature folder: section headers, read-only note, color picker, sortable
// lists on @dnd-kit, error → toast helper).

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock } from "lucide-react";
import { OPTION_COLORS } from "../../../core/fields";
import { Popover, dotClass, usePopover } from "../../../components/ui";
import { cn } from "../../../shared/lib/utils";
import { toast } from "../../../shared/lib/toast";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Runs an op: error → toast.error, success → optional toast.success.
export async function runOp<T>(fn: () => Promise<T>, success?: string | ((value: T) => string)): Promise<T | undefined> {
  try {
    const value = await fn();
    if (success) toast.success(typeof success === "function" ? success(value) : success);
    return value;
  } catch (err) {
    toast.error(errorMessage(err));
    return undefined;
  }
}

export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-surface-900 dark:text-white">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-surface-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ReadOnlyNote({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div data-testid="read-only-note" className="mb-4 flex items-center gap-2 rounded-md border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-600 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-300">
      <Lock className="h-3.5 w-3.5 shrink-0" />
      <span>{children ?? t("common.readOnly")}</span>
    </div>
  );
}

export function StatTile({ label, value, tone = "default" }: { label: ReactNode; value: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = {
    default: "text-surface-900 dark:text-white",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  }[tone];
  return (
    <div className="rounded-md border border-surface-200 bg-white px-3 py-2 dark:border-surface-800 dark:bg-surface-900">
      <div className="text-xs text-surface-500">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", toneClass)}>{value}</div>
    </div>
  );
}

// Swatch row (inline) — used in object / stage forms.
export function ColorSwatches({ value, onChange, disabled, label }: { value: string; onChange(color: string): void; disabled?: boolean; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {OPTION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cn(
            "h-5 w-5 rounded-full ring-offset-2 ring-offset-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-50 dark:ring-offset-surface-900",
            dotClass(c),
            value === c && "ring-2 ring-surface-900 dark:ring-white",
          )}
        />
      ))}
    </div>
  );
}

// Compact color dot opening a swatch popover — used in dense rows.
export function ColorDot({ value, onChange, disabled, label }: { value: string; onChange(color: string): void; disabled?: boolean; label?: string }) {
  const p = usePopover();
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        disabled={disabled}
        aria-label={label ?? value}
        title={label ?? value}
        onClick={p.toggle}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed dark:hover:bg-surface-800"
      >
        <span className={cn("h-3 w-3 rounded-full", dotClass(value))} />
      </button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor}>
        <div className="p-2">
          <ColorSwatches
            value={value}
            label={label}
            onChange={(c) => {
              onChange(c);
              p.close();
            }}
          />
        </div>
      </Popover>
    </>
  );
}

// ─── Sortable lists ─────────────────────────────────────────────────────

export function SortableList({ ids, onReorder, disabled, children }: { ids: string[]; onReorder(ids: string[]): void; disabled?: boolean; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({ id, disabled, className, children, handleLabel }: { id: string; disabled?: boolean; className?: string; handleLabel?: string; children: (handle: ReactNode) => ReactNode }) {
  const s = useSortable({ id, disabled });
  const style = { transform: CSS.Transform.toString(s.transform), transition: s.transition };
  const handle = (
    <button
      type="button"
      aria-label={handleLabel ?? "Drag to reorder"}
      title={handleLabel}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-surface-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
        disabled ? "cursor-default opacity-30" : "cursor-grab hover:bg-surface-100 hover:text-surface-600 active:cursor-grabbing dark:hover:bg-surface-800",
      )}
      {...s.attributes}
      {...s.listeners}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <div ref={s.setNodeRef} style={style} className={cn("relative", s.isDragging && "z-10 opacity-90 shadow-pop", className)}>
      {children(handle)}
    </div>
  );
}
