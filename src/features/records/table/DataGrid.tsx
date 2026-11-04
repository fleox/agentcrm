// Spreadsheet-like table of records: sticky header + first columns,
// resizable columns, windowed rows (10k+), inline editing with
// FieldInput, keyboard navigation (arrows / Enter / Esc / Space / ⌘↵),
// row selection and an inline "+ New" row.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpRight, EyeOff, Plus } from "lucide-react";
import { recordLabel } from "../../../core/fields";
import { getRecordValue } from "../../../core/query";
import type { CrmRecord, FieldDef, ObjectDef, Sort } from "../../../core/types";
import { RecordAvatar, Checkbox, Dropdown, FieldValue, ObjectIcon, useFieldContext } from "../../../components/ui";
import { cn } from "../../../shared/lib/utils";
import { columnField } from "../lib/viewModel";
import { CellEditor } from "./CellEditor";
import { useRowHeight } from "../../../app/appearanceHooks";

// Default row height (comfortable density); the grid reads the live value
// of the workspace density (--row-h) through useRowHeight().
export const ROW_HEIGHT = 33;
const HEADER_HEIGHT = 33;
const SELECT_WIDTH = 36;
const OVERSCAN = 8;

const DEFAULT_WIDTHS: Partial<Record<FieldDef["type"], number>> = {
  text: 180,
  longText: 260,
  email: 220,
  url: 180,
  phone: 150,
  number: 120,
  currency: 140,
  percent: 110,
  date: 130,
  datetime: 170,
  boolean: 90,
  select: 150,
  multiSelect: 200,
  tags: 200,
  relation: 200,
  user: 160,
  rating: 120,
  address: 240,
};

export function defaultColumnWidth(field: FieldDef | undefined, isLabel: boolean): number {
  if (isLabel) return 240;
  return (field && DEFAULT_WIDTHS[field.type]) ?? 160;
}

// Columns whose value lives on the record (not in fields) and is editable.
function isEditable(object: ObjectDef, colId: string): boolean {
  if (colId === "ownerId") return true;
  return object.fields.some((f) => f.id === colId);
}

export interface DataGridProps {
  object: ObjectDef;
  rows: CrmRecord[];
  columns: string[];
  widths: Record<string, number>;
  onResize(col: string, width: number): void;
  sorts: Sort[];
  onSort(field: string, dir: "asc" | "desc" | null): void;
  onHideColumn(col: string): void;
  canWrite: boolean;
  selection: Set<string>;
  onSelectionChange(next: Set<string>): void;
  onOpen(record: CrmRecord): void;
  onSave(record: CrmRecord, col: string, value: unknown): void;
  onQuickAdd?(label: string): Promise<void>;
  // Columns showing a partial value (rollups narrowed by the filters):
  // editing them inline would save the partial value.
  readOnlyColumns?: readonly string[];
}

interface Cell {
  row: number;
  col: number;
}

export function DataGrid(props: DataGridProps) {
  const rowHeight = useRowHeight();
  const { object, rows, columns, widths, canWrite, selection, onSelectionChange, onOpen, onSave } = props;
  const { t } = useTranslation("records");
  const ctx = useFieldContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [active, setActive] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<Cell | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const lastClicked = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 600);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the active cell inside the data.
  useEffect(() => {
    if (active && active.row >= rows.length) setActive(rows.length ? { row: rows.length - 1, col: active.col } : null);
  }, [rows.length, active]);

  const fields = useMemo(() => columns.map((c) => columnField(object, c)), [columns, object]);
  const widthOf = (c: string, i: number) => widths[c] ?? defaultColumnWidth(fields[i], i === 0);
  const totalWidth = SELECT_WIDTH + columns.reduce((a, c, i) => a + widthOf(c, i), 0) + 48;

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const visibleCount = Math.ceil(viewport / rowHeight) + OVERSCAN * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const slice = rows.slice(start, end);

  const focusGrid = () => scrollRef.current?.focus({ preventScroll: true });

  const scrollToRow = useCallback(
    (row: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const top = row * rowHeight;
      const visible = (el.clientHeight || viewport) - HEADER_HEIGHT - rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top > el.scrollTop + visible) el.scrollTop = top - visible;
    },
    [viewport, rowHeight],
  );

  const move = (dr: number, dc: number) => {
    if (!rows.length) return;
    const cur = active ?? { row: 0, col: 0 };
    const row = Math.max(0, Math.min(rows.length - 1, cur.row + dr));
    const col = Math.max(0, Math.min(columns.length - 1, cur.col + dc));
    setActive({ row, col });
    scrollToRow(row);
  };

  const startEdit = (cell: Cell) => {
    if (!canWrite || !isEditable(object, columns[cell.col]) || props.readOnlyColumns?.includes(columns[cell.col])) return;
    setActive(cell);
    setEditing(cell);
  };

  const toggleRow = (id: string, index: number, shift: boolean) => {
    const next = new Set(selection);
    if (shift && lastClicked.current !== null) {
      const [a, b] = [lastClicked.current, index].sort((x, y) => x - y);
      const on = !selection.has(id);
      for (let i = a; i <= b; i++) on ? next.add(rows[i].id) : next.delete(rows[i].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    lastClicked.current = index;
    onSelectionChange(next);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== scrollRef.current || editing) return;
    const page = Math.max(1, Math.floor(viewport / rowHeight) - 1);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1, 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        move(0, 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(0, -1);
        break;
      case "PageDown":
        e.preventDefault();
        move(page, 0);
        break;
      case "PageUp":
        e.preventDefault();
        move(-page, 0);
        break;
      case "Home":
        e.preventDefault();
        e.metaKey || e.ctrlKey ? (setActive({ row: 0, col: 0 }), scrollToRow(0)) : move(0, -columns.length);
        break;
      case "End":
        e.preventDefault();
        e.metaKey || e.ctrlKey ? (setActive({ row: rows.length - 1, col: columns.length - 1 }), scrollToRow(rows.length - 1)) : move(0, columns.length);
        break;
      case "Enter":
      case "F2":
        if (!active) return move(0, 0);
        e.preventDefault();
        if (e.metaKey || e.ctrlKey || e.shiftKey) onOpen(rows[active.row]);
        else startEdit(active);
        break;
      case " ":
        if (!active) return;
        e.preventDefault();
        toggleRow(rows[active.row].id, active.row, e.shiftKey);
        break;
      case "Escape":
        if (selection.size) onSelectionChange(new Set());
        else setActive(null);
        break;
      case "a":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          onSelectionChange(new Set(rows.map((r) => r.id)));
        }
        break;
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => selection.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selection.has(r.id));

  const stickyBg = "bg-white dark:bg-surface-950";

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length}
      aria-label={object.labelPlural}
      data-testid="data-grid"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto outline-none"
    >
      <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: "fixed", width: totalWidth }}>
        <colgroup>
          <col style={{ width: SELECT_WIDTH }} />
          {columns.map((c, i) => (
            <col key={c} style={{ width: widthOf(c, i) }} />
          ))}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className={cn("sticky left-0 top-0 z-30 h-8 border-b border-r border-surface-200 px-2 dark:border-surface-800", stickyBg)}>
              <Checkbox aria-label={t("table.selectAll")} checked={allSelected} indeterminate={someSelected} onChange={() => onSelectionChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
            </th>
            {columns.map((c, i) => (
              <HeaderCell
                key={c}
                field={fields[i]}
                col={c}
                width={widthOf(c, i)}
                sticky={i === 0}
                sort={props.sorts.find((s) => s.field === c)?.dir}
                onSort={(dir) => props.onSort(c, dir)}
                onHide={i === 0 ? undefined : () => props.onHideColumn(c)}
                onResize={(w) => props.onResize(c, w)}
              />
            ))}
            <th className={cn("sticky top-0 z-20 h-8 border-b border-surface-200 dark:border-surface-800", stickyBg)} />
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr aria-hidden="true" style={{ height: start * rowHeight }}>
              <td colSpan={columns.length + 2} />
            </tr>
          )}
          {slice.map((r, k) => {
            const index = start + k;
            const selected = selection.has(r.id);
            const rowActive = active?.row === index;
            const rowBg = selected ? "bg-accent-50 dark:bg-[#151b30]" : rowActive ? "bg-surface-50 dark:bg-surface-900" : "bg-white group-hover:bg-surface-50 dark:bg-surface-950 dark:group-hover:bg-surface-900";
            return (
              <tr key={r.id} className="group" data-row-id={r.id} aria-rowindex={index + 1} aria-selected={selected}>
                <td className={cn("sticky left-0 z-10 h-row border-b border-r border-surface-100 px-2 dark:border-surface-800/70", rowBg)}>
                  <Checkbox
                    aria-label={t("table.selectRow", { name: recordLabel(object, r) })}
                    checked={selected}
                    onChange={() => undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(r.id, index, e.shiftKey);
                    }}
                  />
                </td>
                {columns.map((c, i) => {
                  const field = fields[i];
                  const isActive = rowActive && active?.col === i;
                  const isEditing = editing?.row === index && editing.col === i;
                  const value = c === object.labelField ? r.fields[c] : getRecordValue(r, c);
                  return (
                    <td
                      key={c}
                      data-col={c}
                      role="gridcell"
                      onClick={() => {
                        if (isActive && !isEditing) startEdit({ row: index, col: i });
                        else {
                          setActive({ row: index, col: i });
                          focusGrid();
                        }
                      }}
                      onDoubleClick={() => startEdit({ row: index, col: i })}
                      className={cn(
                        "relative h-row border-b border-r border-surface-100 px-2 text-surface-800 dark:border-surface-800/70 dark:text-surface-200",
                        isEditing ? "overflow-visible" : "overflow-hidden whitespace-nowrap",
                        i === 0 && "sticky z-10 font-medium",
                        rowBg,
                        isActive && !isEditing && "outline outline-2 -outline-offset-2 outline-accent-500/70",
                      )}
                      style={i === 0 ? { left: SELECT_WIDTH } : undefined}
                    >
                      {i === 0 ? (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <RecordAvatar recordId={r.id} name={recordLabel(object, r)} size="sm" square={object.id === "companies"} />
                          <button
                            type="button"
                            className="min-w-0 truncate text-left hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(r);
                            }}
                          >
                            {recordLabel(object, r)}
                          </button>
                          <button
                            type="button"
                            aria-label={t("table.open")}
                            className="ml-auto hidden shrink-0 items-center gap-0.5 rounded border border-surface-200 bg-white px-1 text-2xs text-surface-500 group-hover:inline-flex dark:border-surface-700 dark:bg-surface-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(r);
                            }}
                          >
                            <ArrowUpRight className="h-3 w-3" />
                            {t("table.open")}
                          </button>
                        </div>
                      ) : field ? (
                        <FieldValue field={field} value={value} compact recordId={r.id} />
                      ) : null}
                      {isEditing && field && (
                        <CellEditor
                          field={c === "ownerId" ? { ...field, type: "user" } : field}
                          value={value}
                          className="absolute left-0 top-0 z-40 min-w-full"
                          onCommit={(v) => onSave(r, c, v)}
                          onClose={() => {
                            setEditing(null);
                            focusGrid();
                          }}
                        />
                      )}
                    </td>
                  );
                })}
                <td className={cn("h-row border-b border-surface-100 dark:border-surface-800/70", rowBg)} />
              </tr>
            );
          })}
          {end < rows.length && (
            <tr aria-hidden="true" style={{ height: (rows.length - end) * rowHeight }}>
              <td colSpan={columns.length + 2} />
            </tr>
          )}
          {canWrite && props.onQuickAdd && (
            <tr>
              <td className={cn("sticky left-0 z-10 h-row border-b border-r border-surface-100 dark:border-surface-800/70", stickyBg)} />
              <td className={cn("sticky z-10 h-row border-b border-r border-surface-100 px-1 dark:border-surface-800/70", stickyBg)} style={{ left: SELECT_WIDTH }}>
                {adding ? (
                  <form
                    data-form-type="other"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const label = draftLabel.trim();
                      if (!label) return;
                      await props.onQuickAdd!(label);
                      setDraftLabel("");
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={t("table.newLabel", { field: fields[0]?.label ?? "" })}
                      value={draftLabel}
                      placeholder={fields[0]?.label}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setAdding(false);
                          setDraftLabel("");
                          focusGrid();
                        }
                      }}
                      onBlur={() => !draftLabel && setAdding(false)}
                      className="h-7 w-full rounded border border-accent-500 bg-white px-1.5 text-[13px] outline-none dark:bg-surface-900"
                    />
                  </form>
                ) : (
                  <button type="button" onClick={() => setAdding(true)} className="flex h-7 w-full items-center gap-1.5 px-1 text-[13px] text-surface-400 hover:text-surface-700 dark:hover:text-surface-200">
                    <Plus className="h-3.5 w-3.5" />
                    {t("table.addRow")}
                  </button>
                )}
              </td>
              <td colSpan={columns.length} className="h-row border-b border-surface-100 dark:border-surface-800/70" />
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="pointer-events-none flex flex-col items-center gap-2 py-16 text-sm text-surface-400">
          <ObjectIcon name={object.icon} color={object.color} tile />
          {t("table.noRows")}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {active && rows[active.row] ? `${recordLabel(object, rows[active.row])} — ${fields[active.col]?.label ?? ""}` : ""}
      </span>
      {/* Locale dependency so values re-format on language change. */}
      <span hidden>{ctx.locale}</span>
    </div>
  );
}

function HeaderCell({
  field,
  col,
  width,
  sticky,
  sort,
  onSort,
  onHide,
  onResize,
}: {
  field: FieldDef | undefined;
  col: string;
  width: number;
  sticky: boolean;
  sort?: "asc" | "desc";
  onSort(dir: "asc" | "desc" | null): void;
  onHide?: () => void;
  onResize(width: number): void;
}) {
  const { t } = useTranslation("records");
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width;
    const onMove = (ev: MouseEvent) => onResize(Math.max(70, Math.min(800, w0 + ev.clientX - x0)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <th
      data-col={col}
      className={cn("group/th sticky top-0 z-20 h-8 border-b border-r border-surface-200 bg-white p-0 text-left text-xs font-medium text-surface-500 dark:border-surface-800 dark:bg-surface-950", sticky && "z-30")}
      style={sticky ? { left: SELECT_WIDTH } : undefined}
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
    >
      <Dropdown
        trigger={({ ref, onClick }) => (
          <button ref={ref as never} type="button" onClick={onClick} className="flex h-8 w-full min-w-0 items-center gap-1 px-2 hover:bg-surface-50 dark:hover:bg-surface-900">
            <span className="truncate">{field?.label ?? col}</span>
            {sort === "asc" && <ArrowUp className="h-3 w-3 shrink-0 text-accent-600" />}
            {sort === "desc" && <ArrowDown className="h-3 w-3 shrink-0 text-accent-600" />}
          </button>
        )}
        items={[
          { id: "asc", label: t("sorts.asc"), icon: <ArrowUp />, checked: sort === "asc", onSelect: () => onSort(sort === "asc" ? null : "asc") },
          { id: "desc", label: t("sorts.desc"), icon: <ArrowDown />, checked: sort === "desc", onSelect: () => onSort(sort === "desc" ? null : "desc") },
          ...(onHide ? [{ id: "hide", label: t("columns.hideColumn"), icon: <EyeOff />, separator: true, onSelect: onHide }] : []),
        ]}
      />
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={t("columns.resize")}
        onMouseDown={startResize}
        onDoubleClick={() => onResize(defaultColumnWidth(field, sticky))}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 hover:bg-accent-500/40 group-hover/th:opacity-100"
      />
    </th>
  );
}
