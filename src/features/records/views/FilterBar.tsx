// Filter chips + filter builder popover for every field type and every
// operator supported by core/query.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter as FilterIcon, Plus, Search, X } from "lucide-react";
import { formatFieldValue } from "../../../core/fields";
import type { FieldDef, Filter, FilterOp, ObjectDef } from "../../../core/types";
import { Button, Checkbox, FieldInput, Input, Popover, Select, useFieldContext, usePopover, Badge } from "../../../components/ui";
import { cn } from "../../../shared/lib/utils";
import { columnField, defaultFilterValue, filterableFields, filterOpsFor, isFilterComplete, opNeedsValue } from "../lib/viewModel";

export function useFilterLabel() {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ctx = useFieldContext();
  return (field: FieldDef | undefined, f: Filter): string => {
    if (!field) return f.field;
    const op = t(`filters.ops.${f.op}`);
    if (!opNeedsValue(f.op)) return `${field.label} ${op}`;
    const one = (v: unknown): string => {
      if (v === undefined || v === null || v === "") return "…";
      if (field.type === "select" || field.type === "multiSelect") return field.options?.find((o) => o.id === v)?.label ?? String(v);
      if (field.type === "user") return ctx.users.find((u) => u.id === v)?.name ?? String(v);
      if (field.type === "relation" && (f.op === "eq" || f.op === "neq")) return ctx.recordLabel(String(v)) ?? String(v);
      if (field.type === "boolean") return v === true || v === "true" ? tc("common.yes") : tc("common.no");
      if (f.op === "withinDays") return t("filters.days", { count: Number(v) });
      if (field.type === "date" || field.type === "datetime") return typeof v === "string" && !/^\d{4}-/.test(v) ? v : formatFieldValue({ ...field, type: "date" }, v, { locale: ctx.locale });
      return String(v);
    };
    const value = Array.isArray(f.value) ? (f.value.length ? f.value.map(one).join(", ") : "…") : one(f.value);
    return `${field.label} ${op} ${value}`;
  };
}

function FilterValueEditor({ field, filter, onChange }: { field: FieldDef; filter: Filter; onChange(value: unknown): void }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ctx = useFieldContext();
  const [q, setQ] = useState("");
  if (!opNeedsValue(filter.op)) return null;
  if (filter.op === "withinDays") {
    return (
      <div className="space-y-1">
        <Input inputMode="numeric" autoFocus value={filter.value === undefined ? "" : String(filter.value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value) || 0)} />
        <p className="text-2xs text-surface-400">{t("filters.withinDaysHint")}</p>
      </div>
    );
  }
  if (filter.op === "in" || filter.op === "notIn") {
    const selected = (Array.isArray(filter.value) ? filter.value : []).map(String);
    const items =
      field.type === "user"
        ? ctx.users.filter((u) => !u.disabled).map((u) => ({ id: u.id, label: u.name, color: undefined as string | undefined }))
        : (field.options ?? []).map((o) => ({ id: o.id, label: o.label, color: o.color as string | undefined }));
    const shown = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
    return (
      <div className="space-y-1.5">
        {items.length > 8 && <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tc("common.search")} />}
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {shown.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-100 dark:hover:bg-surface-800">
              <Checkbox checked={selected.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))} />
              {i.color !== undefined ? <Badge color={i.color}>{i.label}</Badge> : <span className="truncate">{i.label}</span>}
            </label>
          ))}
        </div>
      </div>
    );
  }
  switch (field.type) {
    case "boolean":
      return (
        <Select
          value={filter.value === false || filter.value === "false" ? "false" : "true"}
          onChange={(e) => onChange(e.target.value === "true")}
          options={[
            { value: "true", label: tc("common.yes") },
            { value: "false", label: tc("common.no") },
          ]}
        />
      );
    case "select":
    case "multiSelect":
      return <FieldInput field={{ ...field, type: "select" }} value={filter.value} onChange={onChange} />;
    case "user":
      return <FieldInput field={field} value={filter.value} onChange={onChange} />;
    case "relation":
      if (filter.op === "eq" || filter.op === "neq") return <FieldInput field={{ ...field, relation: { ...field.relation!, cardinality: "one" } }} value={filter.value} onChange={onChange} />;
      return <Input autoFocus value={String(filter.value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "date":
    case "datetime":
      return (
        <div className="space-y-1">
          <Input type="date" autoFocus value={typeof filter.value === "string" && /^\d{4}-/.test(filter.value) ? filter.value.slice(0, 10) : ""} onChange={(e) => onChange(e.target.value || undefined)} />
          <div className="flex gap-1">
            {["today", "-7d", "+7d", "-30d"].map((v) => (
              <button key={v} type="button" onClick={() => onChange(v)} className={cn("rounded border px-1.5 py-0.5 text-2xs", filter.value === v ? "border-accent-500 text-accent-700 dark:text-accent-300" : "border-surface-200 text-surface-500 dark:border-surface-700")}>
                {t(`filters.relative.${v}`)}
              </button>
            ))}
          </div>
        </div>
      );
    case "number":
    case "currency":
    case "percent":
    case "rating":
      return <Input inputMode="decimal" autoFocus value={filter.value === undefined ? "" : String(filter.value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />;
    default:
      return <Input autoFocus value={String(filter.value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={t("filters.valuePlaceholder")} />;
  }
}

function FilterEditor({ object, filter, onChange, onRemove }: { object: ObjectDef; filter: Filter; onChange(f: Filter): void; onRemove(): void }) {
  const { t } = useTranslation("records");
  const field = columnField(object, filter.field);
  if (!field) return null;
  const ops = filterOpsFor(field.type);
  return (
    <div className="w-72 space-y-2 p-3" data-testid="filter-editor">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-surface-600 dark:text-surface-300">{field.label}</span>
        <button type="button" onClick={onRemove} className="text-xs text-surface-400 hover:text-red-600">
          {t("filters.remove")}
        </button>
      </div>
      <Select
        aria-label={t("filters.operator")}
        value={filter.op}
        onChange={(e) => {
          const op = e.target.value as FilterOp;
          const keep = opNeedsValue(op) && (Array.isArray(filter.value) === (op === "in" || op === "notIn")) && op !== "withinDays" && filter.op !== "withinDays";
          onChange({ ...filter, op, value: keep ? filter.value : defaultFilterValue(field, op) });
        }}
        options={ops.map((op) => ({ value: op, label: t(`filters.ops.${op}`) }))}
      />
      <FilterValueEditor field={field} filter={filter} onChange={(value) => onChange({ ...filter, value })} />
    </div>
  );
}

function FilterChip({ object, filter, index, onChange, onRemove, autoOpen, readOnly }: { object: ObjectDef; filter: Filter; index: number; onChange(f: Filter): void; onRemove(): void; autoOpen: boolean; readOnly?: boolean }) {
  const { t } = useTranslation("records");
  const p = usePopover();
  const label = useFilterLabel();
  const { setOpen, anchor } = p;
  useEffect(() => {
    if (autoOpen && anchor) setOpen(true);
  }, [autoOpen, anchor, setOpen]);
  const field = columnField(object, filter.field);
  const complete = isFilterComplete(filter);
  return (
    <>
      <span
        ref={p.anchorRef}
        data-testid={`filter-chip-${index}`}
        className={cn(
          "inline-flex h-6 max-w-[280px] items-center gap-1 rounded-md border pl-2 pr-1 text-xs",
          complete ? "border-accent-200 bg-accent-50 text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-200" : "border-dashed border-surface-300 text-surface-500 dark:border-surface-700",
        )}
      >
        <button type="button" disabled={readOnly} className="min-w-0 truncate" onClick={p.toggle}>
          {label(field, filter)}
        </button>
        {!readOnly && (
          <button type="button" aria-label={t("filters.remove")} onClick={onRemove} className="rounded p-0.5 opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor}>
        <FilterEditor
          object={object}
          filter={filter}
          onChange={onChange}
          onRemove={() => {
            p.close();
            onRemove();
          }}
        />
      </Popover>
    </>
  );
}

export function FieldPickerList({ fields, onPick, placeholder }: { fields: FieldDef[]; onPick(f: FieldDef): void; placeholder: string }) {
  const { t: tc } = useTranslation();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => fields.filter((f) => f.label.toLowerCase().includes(q.toLowerCase())), [fields, q]);
  return (
    <div className="w-60">
      <div className="flex items-center gap-2 border-b border-surface-100 px-2.5 dark:border-surface-800">
        <Search className="h-4 w-4 shrink-0 text-surface-400" />
        <input
          autoFocus
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && shown[active]) {
              e.preventDefault();
              onPick(shown[active]);
            }
          }}
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-surface-400"
        />
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {shown.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(f)}
            className={cn("flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[13px]", i === active && "bg-surface-100 dark:bg-surface-800")}
          >
            <span className="truncate">{f.label}</span>
            <span className="shrink-0 text-2xs text-surface-400">{tc(`fieldTypes.${f.type}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterBar({ object, filters, onChange, readOnly }: { object: ObjectDef; filters: Filter[]; onChange(filters: Filter[]): void; readOnly?: boolean }) {
  const { t } = useTranslation("records");
  const p = usePopover();
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const add = (field: FieldDef) => {
    const op = filterOpsFor(field.type)[0];
    onChange([...filters, { field: field.id, op, value: defaultFilterValue(field, op) }]);
    setJustAdded(filters.length);
    p.close();
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f, i) => (
        <FilterChip
          key={`${i}-${f.field}`}
          index={i}
          object={object}
          filter={f}
          autoOpen={justAdded === i}
          readOnly={readOnly}
          onChange={(nf) => onChange(filters.map((x, j) => (j === i ? nf : x)))}
          onRemove={() => {
            setJustAdded(null);
            onChange(filters.filter((_, j) => j !== i));
          }}
        />
      ))}
      {!readOnly && (
        <>
          <Button ref={p.anchorRef as never} size="xs" variant="ghost" icon={filters.length ? <Plus /> : <FilterIcon />} onClick={p.toggle}>
            {t("filters.add")}
          </Button>
          <Popover open={p.open} onClose={p.close} anchor={p.anchor}>
            <FieldPickerList fields={filterableFields(object)} onPick={add} placeholder={t("filters.pickField")} />
          </Popover>
        </>
      )}
      {filters.length > 0 && !readOnly && (
        <button type="button" onClick={() => onChange([])} className="ml-1 text-xs text-surface-400 hover:text-surface-700 dark:hover:text-surface-200">
          {t("filters.clearAll")}
        </button>
      )}
    </div>
  );
}
