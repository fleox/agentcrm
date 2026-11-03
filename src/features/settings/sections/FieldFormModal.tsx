// Create / edit a field of any FieldType: label, type (with migration
// warning on change), description, flags, select options (color, reorder,
// add, remove with "move values to"), currency, relation target +
// cardinality + inverse label, default value.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, GitBranch, Lock, Plus, Save, X } from "lucide-react";
import { Button, Checkbox, FieldInput, FormField, IconButton, Input, Modal, Select, Textarea, confirmDialog } from "../../../components/ui";
import { useObjects, useOps, usePipelines, useRecords } from "../../../app/CrmDataContext";
import { canConvertType, colorAt, isEmptyFieldValue } from "../../../core/fields";
import { slugId } from "../../../core/ids";
import { FIELD_TYPES, type FieldDef, type FieldType, type ObjectDef, type SelectOption } from "../../../core/types";
import { createField, removeOption, updateField, type FieldPatch } from "../../../ops/schema";
import { toast } from "../../../shared/lib/toast";
import { ColorDot, ReadOnlyNote, SortableItem, SortableList, errorMessage } from "../components/common";
import { isPipelineManagedField } from "./FieldsEditor";

interface DraftOption {
  key: string;
  id?: string;
  label: string;
  color: string;
}

interface RemovedOption {
  id: string;
  label: string;
  replaceWith: string;
}

const NO_DEFAULT_TYPES: FieldType[] = ["relation", "address"];
const isOptionType = (type: FieldType) => type === "select" || type === "multiSelect";

let keySeq = 0;
const newKey = () => `new:${++keySeq}`;

export function FieldFormModal({ object, field, onClose, readOnly }: { object: ObjectDef; field: FieldDef | null; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const objects = useObjects({ includeHidden: true });
  const pipelines = usePipelines(object.id);
  const records = useRecords(object.id, { includeDeleted: true });
  const managed = !!field && isPipelineManagedField(pipelines, object.id, field.id);
  const typeLocked = !!field && (!!field.system || managed || field.type === "relation");

  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [description, setDescription] = useState(field?.description ?? "");
  const [required, setRequired] = useState(!!field?.required);
  const [unique, setUnique] = useState(!!field?.unique);
  const [hidden, setHidden] = useState(!!field?.hidden);
  const [currency, setCurrency] = useState(field?.currency ?? "USD");
  const [relObject, setRelObject] = useState(field?.relation?.object ?? objects.find((o) => o.id !== object.id)?.id ?? object.id);
  const [cardinality, setCardinality] = useState<"one" | "many">(field?.relation?.cardinality ?? "one");
  const [inverseField, setInverseField] = useState(field?.relation?.inverseField ?? "");
  const [options, setOptions] = useState<DraftOption[]>(() => (field?.options ?? []).map((o) => ({ key: o.id, id: o.id, label: o.label, color: o.color })));
  const [removed, setRemoved] = useState<RemovedOption[]>([]);
  const [newOption, setNewOption] = useState("");
  const [defaultValue, setDefaultValue] = useState<unknown>(field?.defaultValue ?? undefined);
  const [saving, setSaving] = useState(false);

  const typeChanged = !!field && type !== field.type;
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    if (!field) return m;
    for (const r of records) {
      const v = r.fields[field.id];
      for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string") m.set(x, (m.get(x) ?? 0) + 1);
    }
    return m;
  }, [records, field]);
  const usedCount = field ? records.filter((r) => !isEmptyFieldValue(field, r.fields[field.id])).length : 0;

  const typeOptions = FIELD_TYPES.filter((ft) => !field || ft === field.type || canConvertType(field.type, ft)).map((ft) => ({ value: ft, label: tc(`fieldTypes.${ft}`) }));

  // Draft field fed to FieldInput for the default value.
  const draftField: FieldDef = {
    id: field?.id ?? "draft",
    label: label || "—",
    type,
    options: options.map((o) => ({ id: o.key, label: o.label, color: o.color })),
    currency,
    ...(type === "relation" ? { relation: { object: relObject, cardinality } } : {}),
  };

  const addDraftOption = () => {
    const l = newOption.trim();
    if (!l) return;
    if (options.some((o) => o.label.toLowerCase() === l.toLowerCase())) {
      toast.warn(t("fields.optionExists", { label: l }));
      return;
    }
    setOptions([...options, { key: newKey(), label: l, color: colorAt(options.length) }]);
    setNewOption("");
  };

  const removeDraftOption = (o: DraftOption) => {
    setOptions(options.filter((x) => x.key !== o.key));
    if (o.id && field?.options?.some((x) => x.id === o.id) && !typeChanged) setRemoved([...removed, { id: o.id, label: o.label, replaceWith: "" }]);
    if (defaultValue === o.key) setDefaultValue(undefined);
    if (Array.isArray(defaultValue)) setDefaultValue(defaultValue.filter((x) => x !== o.key));
  };

  // Final option ids (existing kept, new ones slugged) + key → id map.
  const finalOptions = (): { list: Array<Partial<SelectOption>>; ids: Map<string, string> } => {
    const taken = new Set(options.filter((o) => o.id).map((o) => o.id!));
    for (const r of removed) taken.add(r.id);
    const ids = new Map<string, string>();
    const list = options.map((o) => {
      const id = o.id ?? slugId(o.label, taken);
      taken.add(id);
      ids.set(o.key, id);
      return { id, label: o.label.trim(), color: o.color };
    });
    return { list, ids };
  };

  const mapDefault = (ids: Map<string, string>): unknown => {
    if (!isOptionType(type)) return defaultValue;
    if (Array.isArray(defaultValue)) return defaultValue.map((k) => ids.get(String(k)) ?? k);
    return typeof defaultValue === "string" ? (ids.get(defaultValue) ?? defaultValue) : defaultValue;
  };

  const submit = async () => {
    if (!label.trim()) return;
    const { list, ids } = finalOptions();
    const dv = NO_DEFAULT_TYPES.includes(type) ? undefined : mapDefault(ids);
    const hasDefault = dv !== undefined && dv !== null && dv !== "" && !(Array.isArray(dv) && dv.length === 0);
    setSaving(true);
    try {
      if (!field) {
        const created = await createField(ops, object.id, {
          label,
          type,
          description: description.trim() || undefined,
          required,
          unique,
          hidden,
          ...(isOptionType(type) ? { options: list } : {}),
          ...(type === "currency" ? { currency } : {}),
          ...(type === "relation" ? { relation: { object: relObject, cardinality, ...(inverseField.trim() ? { inverseField: inverseField.trim() } : {}) } } : {}),
          ...(hasDefault ? { defaultValue: dv } : {}),
        });
        toast.success(t("fields.created", { name: created.label }));
        onClose();
        return;
      }
      if (typeChanged) {
        const ok = await confirmDialog({
          title: t("fields.typeChangeTitle", { from: tc(`fieldTypes.${field.type}`), to: tc(`fieldTypes.${type}`) }),
          description: t("fields.typeChangeConfirm", { count: usedCount }),
          confirmLabel: t("fields.convert"),
          danger: true,
        });
        if (!ok) return;
      }
      for (const r of removed) await removeOption(ops, object.id, field.id, r.id, r.replaceWith ? { replaceWith: r.replaceWith } : {});
      const patch: FieldPatch = {
        label,
        description: description.trim(),
        required,
        unique,
        hidden,
      };
      if (type === "currency") patch.currency = currency;
      if (typeChanged) patch.type = type;
      if (isOptionType(type) && !managed && (list.length || !typeChanged)) patch.options = list;
      const hadDefault = field.defaultValue !== undefined && field.defaultValue !== null;
      if (hasDefault) patch.defaultValue = dv;
      else if (hadDefault || typeChanged) patch.defaultValue = null;
      const res = await updateField(ops, object.id, field.id, patch);
      if (res.converted !== undefined) toast.success(t("fields.typeChanged", { name: res.field.label, converted: res.converted, cleared: res.cleared ?? 0 }));
      else toast.success(t("fields.saved", { name: res.field.label }));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const keptExisting = options.filter((o) => o.id);

  return (
    <Modal open onClose={onClose} size="lg" dismissible={false} title={field ? (readOnly ? field.label : t("fields.editTitle", { name: field.label })) : t("fields.newTitle", { object: object.labelSingular })}>
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {readOnly && <ReadOnlyNote />}
        {field?.system && (
          <p className="flex items-center gap-1.5 text-xs text-surface-500">
            <Lock className="h-3.5 w-3.5" />
            {t("fields.systemHelp")}
          </p>
        )}
        {field?.standard && !field.system && <p className="text-xs text-surface-500">{t("fields.standardHelp")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("fields.label")} htmlFor="field-label">
            <Input id="field-label" autoFocus required value={label} disabled={readOnly} onChange={(e) => setLabel(e.target.value)} placeholder={t("fields.labelPlaceholder")} />
          </FormField>
          <FormField label={t("fields.type")} htmlFor="field-type" help={typeLocked ? t("fields.typeLocked") : undefined}>
            <Select
              id="field-type"
              value={type}
              disabled={readOnly || typeLocked}
              options={typeOptions}
              onChange={(e) => {
                const next = e.target.value as FieldType;
                setType(next);
                setDefaultValue(undefined);
                if (field && next !== field.type) setRemoved([]);
              }}
            />
          </FormField>
        </div>
        {typeChanged && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="type-change-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("fields.typeChangeWarning", { count: usedCount, from: tc(`fieldTypes.${field!.type}`), to: tc(`fieldTypes.${type}`) })}</span>
          </div>
        )}
        <FormField label={t("fields.descriptionLabel")} htmlFor="field-description">
          <Textarea id="field-description" rows={2} value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox label={t("fields.required")} checked={required} disabled={readOnly} onChange={(e) => setRequired(e.target.checked)} />
          <Checkbox label={t("fields.unique")} checked={unique} disabled={readOnly} onChange={(e) => setUnique(e.target.checked)} />
          <Checkbox label={t("fields.hidden")} checked={hidden} disabled={readOnly || field?.id === object.labelField} onChange={(e) => setHidden(e.target.checked)} />
        </div>

        {type === "currency" && (
          <FormField label={t("fields.currency")} htmlFor="field-currency">
            <Input id="field-currency" value={currency} maxLength={3} disabled={readOnly} className="w-28" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </FormField>
        )}

        {type === "relation" && (
          <div className="grid gap-3 rounded-md border border-surface-200 p-3 sm:grid-cols-3 dark:border-surface-800">
            <FormField label={t("fields.relationObject")} htmlFor="field-rel-object">
              <Select id="field-rel-object" value={relObject} disabled={readOnly || !!field} options={objects.map((o) => ({ value: o.id, label: o.labelPlural }))} onChange={(e) => setRelObject(e.target.value)} />
            </FormField>
            <FormField label={t("fields.cardinality")} htmlFor="field-rel-card">
              <Select
                id="field-rel-card"
                value={cardinality}
                disabled={readOnly || !!field}
                options={[
                  { value: "one", label: t("fields.cardinalityOne") },
                  { value: "many", label: t("fields.cardinalityMany") },
                ]}
                onChange={(e) => setCardinality(e.target.value === "many" ? "many" : "one")}
              />
            </FormField>
            <FormField label={t("fields.inverseField")} htmlFor="field-rel-inverse" help={t("fields.inverseFieldHelp", { object: objects.find((o) => o.id === relObject)?.labelPlural ?? relObject })}>
              <Input id="field-rel-inverse" value={inverseField} disabled={readOnly || !!field} placeholder={object.labelPlural} onChange={(e) => setInverseField(e.target.value)} />
            </FormField>
            {field && <p className="text-xs text-surface-500 sm:col-span-3">{t("fields.relationLocked")}</p>}
          </div>
        )}

        {isOptionType(type) && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-surface-600 dark:text-surface-300">{t("fields.options")}</span>
              {managed && (
                <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-300">
                  <GitBranch className="h-3 w-3" />
                  {t("fields.managedByPipelines")}
                </span>
              )}
            </div>
            {managed ? (
              <p className="rounded-md bg-surface-50 px-3 py-2 text-xs text-surface-500 dark:bg-surface-800/60">{t("fields.managedHelp")}</p>
            ) : (
              <>
                <div className="overflow-hidden rounded-md border border-surface-200 dark:border-surface-800" data-testid="options-list">
                  <SortableList ids={options.map((o) => o.key)} disabled={readOnly} onReorder={(keys) => setOptions(keys.map((k) => options.find((o) => o.key === k)!))}>
                    {options.map((o) => (
                      <SortableItem key={o.key} id={o.key} disabled={readOnly} handleLabel={t("fields.dragHandle")} className="border-b border-surface-100 bg-white last:border-b-0 dark:border-surface-800 dark:bg-surface-900">
                        {(handle) => (
                          <div className="flex items-center gap-1.5 px-1.5 py-1">
                            {handle}
                            <ColorDot value={o.color} disabled={readOnly} label={t("fields.optionColor")} onChange={(c) => setOptions(options.map((x) => (x.key === o.key ? { ...x, color: c } : x)))} />
                            <Input
                              aria-label={t("fields.optionLabel")}
                              value={o.label}
                              disabled={readOnly}
                              className="h-7 flex-1 border-transparent shadow-none hover:border-surface-200 dark:border-transparent"
                              onChange={(e) => setOptions(options.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)))}
                            />
                            {o.id && usage.get(o.id) ? <span className="text-xs tabular-nums text-surface-400">{t("fields.optionUsage", { count: usage.get(o.id) })}</span> : null}
                            {!readOnly && <IconButton size="xs" label={tc("common.remove")} icon={<X />} onClick={() => removeDraftOption(o)} />}
                          </div>
                        )}
                      </SortableItem>
                    ))}
                  </SortableList>
                  {!options.length && <p className="px-3 py-2 text-xs text-surface-500">{typeChanged ? t("fields.optionsFromValues") : t("fields.noOptions")}</p>}
                </div>
                {!readOnly && (
                  <div className="mt-1.5 flex gap-1.5">
                    <Input
                      aria-label={t("fields.newOption")}
                      placeholder={t("fields.newOption")}
                      value={newOption}
                      onChange={(e) => setNewOption(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addDraftOption();
                        }
                      }}
                    />
                    <Button size="md" icon={<Plus />} onClick={addDraftOption} disabled={!newOption.trim()}>
                      {t("fields.addOption")}
                    </Button>
                  </div>
                )}
                {removed.length > 0 && (
                  <div className="mt-3 space-y-1.5 rounded-md border border-red-200 bg-red-50/50 p-2 dark:border-red-500/30 dark:bg-red-500/5">
                    <div className="text-xs font-medium text-red-700 dark:text-red-300">{t("fields.removedOptions")}</div>
                    {removed.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate line-through">
                          {r.label} <span className="text-xs text-surface-500">({t("fields.optionUsage", { count: usage.get(r.id) ?? 0 })})</span>
                        </span>
                        <span className="text-xs text-surface-500">{t("fields.moveValuesTo")}</span>
                        <Select
                          aria-label={t("fields.moveValuesTo")}
                          className="w-40"
                          value={r.replaceWith}
                          options={[{ value: "", label: t("fields.clearValues") }, ...keptExisting.map((o) => ({ value: o.id!, label: o.label }))]}
                          onChange={(e) => setRemoved(removed.map((x) => (x.id === r.id ? { ...x, replaceWith: e.target.value } : x)))}
                        />
                        <IconButton
                          size="xs"
                          label={t("fields.undoRemove")}
                          icon={<X />}
                          onClick={() => {
                            setRemoved(removed.filter((x) => x.id !== r.id));
                            const prev = field?.options?.find((x) => x.id === r.id);
                            if (prev) setOptions([...options, { key: prev.id, id: prev.id, label: prev.label, color: prev.color }]);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!NO_DEFAULT_TYPES.includes(type) && !managed && (
          <FormField label={t("fields.defaultValue")} help={t("fields.defaultValueHelp")}>
            <FieldInput field={draftField} value={defaultValue} disabled={readOnly} onChange={setDefaultValue} />
          </FormField>
        )}

        <div className="flex justify-end gap-2 border-t border-surface-100 pt-3 dark:border-surface-800">
          <Button variant="ghost" onClick={onClose}>
            {readOnly ? tc("common.close") : tc("common.cancel")}
          </Button>
          {!readOnly && (
            <Button type="submit" variant="primary" icon={field ? <Save /> : <Plus />} loading={saving} disabled={!label.trim()}>
              {field ? tc("common.save") : t("fields.create")}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
