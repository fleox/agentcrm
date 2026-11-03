// Global overlays of the records feature:
//   "record.create" { object, defaults? }      → quick create modal
//   "activity.log"  { type?, target? }          → log activity modal
// (opened from list pages, related tabs, the command palette…).

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Plus } from "lucide-react";
import { isEmptyFieldValue } from "../../../core/fields";
import type { ActivityTarget, ActivityType, FieldDef, ObjectDef } from "../../../core/types";
import { Button, FieldInput, FormField, Modal, ObjectIcon, Select, useFieldContext } from "../../../components/ui";
import { useCan, useObjects, useOps } from "../../../app/CrmDataContext";
import { paths } from "../../../app/paths";
import { useShellEvent } from "../../../app/shellEvents";
import { createRecord } from "../../../ops/records";
import { OpsError } from "../../../ops/context";
import { toast } from "../../../shared/lib/toast";
import { ActivityComposer, COMPOSER_TYPES } from "../detail/ActivityComposer";

export interface RecordCreateDetail {
  object: string;
  defaults?: Record<string, unknown>;
}

// Fields shown in the quick-create form: label field, required ones, the
// pre-filled ones, then the first few visible fields.
export function quickCreateFields(object: ObjectDef, defaults: Record<string, unknown>): FieldDef[] {
  const visible = object.fields.filter((f) => !f.hidden && !(object.id === "people" && f.id === "name"));
  const out: FieldDef[] = [];
  const push = (f: FieldDef | undefined) => f && !out.includes(f) && out.push(f);
  if (object.id === "people") {
    push(visible.find((f) => f.id === "firstName"));
    push(visible.find((f) => f.id === "lastName"));
  } else push(visible.find((f) => f.id === object.labelField));
  visible.filter((f) => f.required).forEach(push);
  visible.filter((f) => f.id in defaults).forEach(push);
  visible.filter((f) => !["longText", "address"].includes(f.type)).slice(0, 6).forEach(push);
  return out;
}

export function QuickCreateModal({ object, defaults, onClose }: { object: ObjectDef; defaults: Record<string, unknown>; onClose(): void }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const navigate = useNavigate();
  const fields = useMemo(() => quickCreateFields(object, defaults), [object, defaults]);
  const [values, setValues] = useState<Record<string, unknown>>(defaults);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"create" | "open" | null>(null);

  const submit = async (open: boolean) => {
    setBusy(open ? "open" : "create");
    setErrors({});
    try {
      const input = Object.fromEntries(Object.entries(values).filter(([k, v]) => object.fields.some((f) => f.id === k && !isEmptyFieldValue(f, v))));
      const record = await createRecord(ops, object.id, input);
      toast.success(t("create.created", { object: object.labelSingular }));
      onClose();
      if (open) navigate(paths.record(object.id, record.id));
    } catch (err) {
      const details = err instanceof OpsError && Array.isArray(err.details) ? (err.details as { field: string; message: string }[]) : [];
      if (details.length) setErrors(Object.fromEntries(details.map((d) => [d.field, d.message])));
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={false}
      title={
        <span className="flex items-center gap-2">
          <ObjectIcon name={object.icon} color={object.color} tile />
          {t("create.title", { object: object.labelSingular })}
        </span>
      }
    >
      <form
        data-form-type="other"
        data-testid="quick-create"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((f, i) => (
            <FormField key={f.id} label={`${f.label}${f.required ? " *" : ""}`} error={errors[f.id]} className={["relation", "tags", "multiSelect"].includes(f.type) || i === 0 ? "sm:col-span-2" : ""}>
              <FieldInput field={f} value={values[f.id]} autoFocus={i === 0} invalid={!!errors[f.id]} onChange={(v) => setValues((p) => ({ ...p, [f.id]: v }))} />
            </FormField>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button variant="outline" loading={busy === "open"} disabled={!!busy} icon={<ArrowUpRight />} onClick={() => void submit(true)}>
            {t("create.createAndOpen")}
          </Button>
          <Button type="submit" variant="primary" loading={busy === "create"} disabled={!!busy} icon={<Plus />}>
            {tc("common.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function QuickCreateHost() {
  const objects = useObjects();
  const canWrite = useCan("records.write");
  const [state, setState] = useState<RecordCreateDetail | null>(null);
  useShellEvent("record.create", (detail) => {
    const d = detail as RecordCreateDetail | undefined;
    if (!canWrite || !d?.object) return;
    setState({ object: d.object, defaults: d.defaults ?? {} });
  });
  const object = state ? objects.find((o) => o.id === state.object) : undefined;
  if (!state || !object) return null;
  return <QuickCreateModal key={`${object.id}-${JSON.stringify(state.defaults)}`} object={object} defaults={state.defaults ?? {}} onClose={() => setState(null)} />;
}

export interface ActivityLogDetail {
  type?: ActivityType;
  target?: ActivityTarget;
}

function TargetPicker({ value, onChange }: { value: ActivityTarget | null; onChange(t: ActivityTarget | null): void }) {
  const { t } = useTranslation("records");
  const objects = useObjects();
  const [objectId, setObjectId] = useState(value?.object ?? objects[0]?.id ?? "");
  const field: FieldDef = { id: "target", label: "", type: "relation", relation: { object: objectId, cardinality: "one" } };
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <Select
        aria-label={t("log.object")}
        value={objectId}
        onChange={(e) => {
          setObjectId(e.target.value);
          onChange(null);
        }}
        options={objects.map((o) => ({ value: o.id, label: o.labelSingular }))}
      />
      <FieldInput key={objectId} field={field} value={value?.id} placeholder={t("log.pickRecord")} onChange={(v) => onChange(v ? { object: objectId, id: String(v) } : null)} />
    </div>
  );
}

export function LogActivityHost() {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ctx = useFieldContext();
  const canLog = useCan("activities.write");
  const [state, setState] = useState<{ type: ActivityType; target: ActivityTarget | null } | null>(null);
  useShellEvent("activity.log", (detail) => {
    const d = (detail ?? {}) as ActivityLogDetail;
    if (!canLog) return;
    setState({ type: d.type && COMPOSER_TYPES.includes(d.type) ? d.type : "note", target: d.target ?? null });
  });
  if (!state) return null;
  return (
    <Modal
      open
      onClose={() => setState(null)}
      dismissible={false}
      title={t("log.title", { type: tc(`activityTypes.${state.type}`) })}
      description={state.target ? ctx.recordLabel(state.target.id) : t("log.pickHint")}
    >
      <div className="space-y-3">
        {!state.target && <TargetPicker value={state.target} onChange={(target) => setState((s) => (s ? { ...s, target } : s))} />}
        {state.target && <ActivityComposer key={`${state.target.id}-${state.type}`} targets={[state.target]} defaultType={state.type} autoFocus onDone={() => setState(null)} />}
      </div>
    </Modal>
  );
}
