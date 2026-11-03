// Condition rows (core/query filters) reusing the field inputs of the kit.
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { systemFieldDef } from "../../core/query";
import type { FieldDef, Filter, FilterOp, ObjectDef } from "../../core/types";
import { Button, FieldInput, IconButton, Input, Select } from "../../components/ui";
import { NO_VALUE_OPS, OP_KEYS } from "./labels";

const SYSTEM_PROPS = ["ownerId", "createdAt", "updatedAt"];

export function conditionFields(object: ObjectDef | undefined): FieldDef[] {
  if (!object) return [];
  return [...object.fields.filter((f) => !f.hidden), ...SYSTEM_PROPS.map((id) => systemFieldDef(id)!).filter(Boolean)];
}

// Which ops make sense for a field type.
export function opsFor(field: FieldDef | undefined): FilterOp[] {
  if (!field) return OP_KEYS;
  switch (field.type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
      return ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"];
    case "date":
    case "datetime":
      return ["eq", "before", "after", "withinDays", "empty", "notEmpty"];
    case "boolean":
      return ["eq", "neq"];
    case "select":
    case "user":
      return ["eq", "neq", "in", "notIn", "empty", "notEmpty"];
    case "multiSelect":
    case "tags":
    case "relation":
      return ["eq", "neq", "contains", "notContains", "empty", "notEmpty"];
    default:
      return ["eq", "neq", "contains", "notContains", "empty", "notEmpty"];
  }
}

// Field definition used to edit the operand of a condition.
function operandField(field: FieldDef, op: FilterOp): FieldDef {
  if ((op === "in" || op === "notIn") && field.type === "select") return { ...field, type: "multiSelect" };
  if ((op === "in" || op === "notIn") && field.type === "user") return { ...field, type: "text" };
  if ((field.type === "multiSelect" || field.type === "tags") && (op === "eq" || op === "neq")) return field.type === "tags" ? { ...field, type: "text" } : { ...field, type: "select" };
  if (field.type === "relation" && (op === "eq" || op === "neq")) return { ...field, relation: field.relation ? { ...field.relation, cardinality: "one" } : field.relation };
  if (field.type === "datetime" && (op === "before" || op === "after" || op === "eq")) return { ...field, type: "date" };
  if (op === "contains" || op === "notContains") return { ...field, type: "text" };
  return { ...field, required: false };
}

export function ConditionValue({ field, op, value, onChange }: { field: FieldDef | undefined; op: FilterOp; value: unknown; onChange(v: unknown): void }) {
  const { t } = useTranslation("automations");
  if (NO_VALUE_OPS.includes(op)) return null;
  if (op === "withinDays") {
    return (
      <Input type="number" className="w-32" aria-label={t("conditions.value")} value={typeof value === "number" ? String(value) : ""} placeholder={t("conditions.daysPlaceholder")} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
    );
  }
  if (!field) return <Input aria-label={t("conditions.value")} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} />;
  return <FieldInput field={operandField(field, op)} value={value} onChange={onChange} />;
}

export function ConditionBuilder({ object, value, onChange, disabled }: { object: ObjectDef | undefined; value: Filter[]; onChange(next: Filter[]): void; disabled?: boolean }) {
  const { t } = useTranslation("automations");
  const fields = conditionFields(object);
  const set = (i: number, patch: Partial<Filter>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-surface-500">{t("conditions.none")}</p>}
      {value.map((c, i) => {
        const field = fields.find((f) => f.id === c.field);
        const ops = opsFor(field);
        return (
          <div key={i} className="flex flex-wrap items-start gap-2 rounded-md bg-surface-50 p-2 dark:bg-surface-900/60">
            <Select
              className="w-44"
              aria-label={t("conditions.field")}
              value={c.field}
              disabled={disabled}
              options={fields.map((f) => ({ value: f.id, label: f.label }))}
              onChange={(e) => {
                const nf = fields.find((f) => f.id === e.target.value);
                set(i, { field: e.target.value, op: opsFor(nf)[0], value: undefined });
              }}
            />
            <Select className="w-44" aria-label={t("conditions.op")} value={c.op} disabled={disabled} options={ops.map((op) => ({ value: op, label: t(`conditions.ops.${op}`) }))} onChange={(e) => set(i, { op: e.target.value as FilterOp, value: undefined })} />
            <div className="min-w-[12rem] flex-1">
              <ConditionValue field={field} op={c.op} value={c.value} onChange={(v) => set(i, { value: v })} />
            </div>
            <IconButton size="sm" label={t("conditions.remove")} icon={<X />} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      <Button size="sm" variant="ghost" icon={<Plus />} disabled={disabled || !fields.length} onClick={() => onChange([...value, { field: fields[0].id, op: opsFor(fields[0])[0] }])}>
        {t("conditions.add")}
      </Button>
    </div>
  );
}
