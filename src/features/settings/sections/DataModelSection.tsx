// Data model: objects list (standard + custom, record counts), custom
// object create / edit / delete, and the fields editor of one object
// (?object=<id>).

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, FormField, IconButton, Input, Modal, OBJECT_ICONS, ObjectIcon, Select, confirmDialog } from "../../../components/ui";
import { useCan, useObject, useObjects, useOps, usePipelines, useRecords } from "../../../app/CrmDataContext";
import type { ObjectDef } from "../../../core/types";
import { createObject, deleteObject, updateObject } from "../../../ops/schema";
import { cn } from "../../../shared/lib/utils";
import { ColorSwatches, ReadOnlyNote, SectionHeader, runOp } from "../components/common";
import { FieldsEditor } from "./FieldsEditor";

export function DataModelSection() {
  const [params, setParams] = useSearchParams();
  const objectId = params.get("object");
  const object = useObject(objectId ?? undefined);
  if (objectId && object) return <ObjectDetail object={object} onBack={() => setParams({})} />;
  return <ObjectsList onOpen={(id) => setParams({ object: id })} />;
}

function ObjectsList({ onOpen }: { onOpen(id: string): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const objects = useObjects({ includeHidden: true });
  const records = useRecords(undefined);
  const pipelines = usePipelines();
  const canEdit = useCan("schema.write");
  const [editing, setEditing] = useState<ObjectDef | "new" | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.object, (m.get(r.object) ?? 0) + 1);
    return m;
  }, [records]);

  const remove = async (o: ObjectDef) => {
    const n = counts.get(o.id) ?? 0;
    const ok = await confirmDialog({
      title: tc("confirm.deleteTitle", { name: o.labelPlural }),
      description: t("dataModel.deleteObjectConfirm", { count: n }),
      confirmLabel: tc("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await runOp(() => deleteObject(ops, o.id), (r) => t("dataModel.objectDeleted", { name: o.labelPlural, count: r.records }));
  };

  const standard = objects.filter((o) => o.standard);
  const custom = objects.filter((o) => !o.standard);

  const row = (o: ObjectDef) => (
    <div key={o.id} className="group flex items-center gap-3 border-b border-surface-100 px-3 py-2 last:border-b-0 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60" onClick={() => onOpen(o.id)} data-testid={`object-row-${o.id}`}>
        <ObjectIcon name={o.icon} color={o.color} tile />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-surface-900 dark:text-white">{o.labelPlural}</span>
          <span className="block truncate text-xs text-surface-500">
            {t("dataModel.fieldCount", { count: o.fields.length })} · {t("dataModel.recordCount", { count: counts.get(o.id) ?? 0 })}
            {pipelines.some((p) => p.object === o.id) ? ` · ${t("dataModel.pipelineCount", { count: pipelines.filter((p) => p.object === o.id).length })}` : ""}
          </span>
        </span>
        <Badge color={o.standard ? "gray" : "purple"}>{o.standard ? t("dataModel.standard") : t("dataModel.custom")}</Badge>
      </button>
      {canEdit && (
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" label={tc("common.edit")} icon={<Pencil />} onClick={() => setEditing(o)} />
          {!o.standard && <IconButton size="sm" label={tc("common.delete")} icon={<Trash2 />} onClick={() => remove(o)} />}
        </div>
      )}
      <ChevronRight className="h-4 w-4 text-surface-300" />
    </div>
  );

  return (
    <div className="max-w-3xl">
      <SectionHeader
        title={t("dataModel.title")}
        description={t("dataModel.description")}
        actions={
          canEdit && (
            <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
              {t("dataModel.newObject")}
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNote />}
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-surface-500">{t("dataModel.standardObjects")}</h3>
      <div className="mb-5 overflow-hidden rounded-lg border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">{standard.map(row)}</div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-surface-500">{t("dataModel.customObjects")}</h3>
      <div className="overflow-hidden rounded-lg border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">
        {custom.length ? custom.map(row) : <EmptyState title={t("dataModel.noCustom")} description={t("dataModel.noCustomHelp")} />}
      </div>
      {editing && <ObjectFormModal object={editing === "new" ? null : editing} onClose={() => setEditing(null)} onCreated={(id) => onOpen(id)} />}
    </div>
  );
}

function ObjectDetail({ object, onBack }: { object: ObjectDef; onBack(): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const canEdit = useCan("schema.write");
  const records = useRecords(object.id);
  const [editing, setEditing] = useState(false);
  return (
    <div className="max-w-4xl">
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[13px] text-surface-500 hover:text-surface-900 dark:hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("dataModel.allObjects")}
      </button>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ObjectIcon name={object.icon} color={object.color} tile />
            {object.labelPlural}
            <Badge color={object.standard ? "gray" : "purple"}>{object.standard ? t("dataModel.standard") : t("dataModel.custom")}</Badge>
          </span>
        }
        description={`${t("dataModel.recordCount", { count: records.length })} · ${t("dataModel.labelFieldIs", { field: object.fields.find((f) => f.id === object.labelField)?.label ?? object.labelField })} · id: ${object.id}`}
        actions={
          canEdit && (
            <Button size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
              {tc("common.edit")}
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNote />}
      <FieldsEditor object={object} />
      {editing && <ObjectFormModal object={object} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function ObjectFormModal({ object, onClose, onCreated }: { object: ObjectDef | null; onClose(): void; onCreated?(id: string): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const [singular, setSingular] = useState(object?.labelSingular ?? "");
  const [plural, setPlural] = useState(object?.labelPlural ?? "");
  const [pluralTouched, setPluralTouched] = useState(!!object);
  const [icon, setIcon] = useState(object?.icon ?? "Box");
  const [color, setColor] = useState(object?.color ?? "blue");
  const [labelField, setLabelField] = useState(object?.labelField ?? "name");
  const [imageField, setImageField] = useState(object?.imageField ?? "");
  const [saving, setSaving] = useState(false);
  const labelCandidates = (object?.fields ?? []).filter((f) => ["text", "email", "url", "phone"].includes(f.type));
  const imageCandidates = (object?.fields ?? []).filter((f) => f.type === "image");

  const submit = async () => {
    setSaving(true);
    if (object) {
      const res = await runOp(() => updateObject(ops, object.id, { labelSingular: singular, labelPlural: plural, icon, color, ...(labelField !== object.labelField ? { labelField } : {}), ...(imageField !== (object.imageField ?? "") ? { imageField: imageField || null } : {}) }), t("dataModel.objectSaved"));
      setSaving(false);
      if (res) onClose();
    } else {
      const res = await runOp(() => createObject(ops, { labelSingular: singular, labelPlural: plural || `${singular}s`, icon, color }), (o) => t("dataModel.objectCreated", { name: o.labelPlural }));
      setSaving(false);
      if (res) {
        onClose();
        onCreated?.(res.id);
      }
    }
  };

  return (
    <Modal open onClose={onClose} title={object ? t("dataModel.editObject") : t("dataModel.newObject")} size="md" dismissible={false}>
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("dataModel.singular")} htmlFor="obj-singular">
            <Input
              id="obj-singular"
              autoFocus
              required
              value={singular}
              placeholder={t("dataModel.singularPlaceholder")}
              onChange={(e) => {
                setSingular(e.target.value);
                if (!pluralTouched) setPlural(e.target.value ? `${e.target.value}s` : "");
              }}
            />
          </FormField>
          <FormField label={t("dataModel.plural")} htmlFor="obj-plural">
            <Input
              id="obj-plural"
              required
              value={plural}
              placeholder={t("dataModel.pluralPlaceholder")}
              onChange={(e) => {
                setPlural(e.target.value);
                setPluralTouched(true);
              }}
            />
          </FormField>
        </div>
        <FormField label={t("dataModel.icon")}>
          <div role="radiogroup" aria-label={t("dataModel.icon")} className="grid max-h-36 grid-cols-10 gap-1 overflow-y-auto rounded-md border border-surface-200 p-1.5 dark:border-surface-700">
            {Object.keys(OBJECT_ICONS).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={icon === name}
                aria-label={name}
                title={name}
                onClick={() => setIcon(name)}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded text-surface-600 hover:bg-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:text-surface-300 dark:hover:bg-surface-800",
                  icon === name && "bg-surface-900 text-white hover:bg-surface-900 dark:bg-white dark:text-surface-900",
                )}
              >
                <ObjectIcon name={name} />
              </button>
            ))}
          </div>
        </FormField>
        <FormField label={t("dataModel.color")}>
          <div className="flex items-center gap-3">
            <ObjectIcon name={icon} color={color} tile className="h-7 w-7" />
            <ColorSwatches value={color} onChange={setColor} label={t("dataModel.color")} />
          </div>
        </FormField>
        {object && (
          <FormField label={t("dataModel.labelField")} htmlFor="obj-label-field" help={t("dataModel.labelFieldHelp")}>
            <Select id="obj-label-field" value={labelField} options={labelCandidates.map((f) => ({ value: f.id, label: f.label }))} onChange={(e) => setLabelField(e.target.value)} />
          </FormField>
        )}
        {object && (
          <FormField label={t("dataModel.imageField")} htmlFor="obj-image-field" help={imageCandidates.length ? t("dataModel.imageFieldHelp") : t("dataModel.imageFieldNone")}>
            <Select
              id="obj-image-field"
              value={imageField}
              disabled={!imageCandidates.length}
              options={[{ value: "", label: t("dataModel.imageFieldInitials") }, ...imageCandidates.map((f) => ({ value: f.id, label: f.label }))]}
              onChange={(e) => setImageField(e.target.value)}
            />
          </FormField>
        )}
        {!object && <p className="text-xs text-surface-500">{t("dataModel.newObjectHelp")}</p>}
        <div className="flex justify-end gap-2 border-t border-surface-100 pt-3 dark:border-surface-800">
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={object ? <Save /> : <Plus />} loading={saving} disabled={!singular.trim()}>
            {object ? tc("common.save") : tc("common.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
