// Create / edit a task: title, markdown description, due date (+ optional
// time), assignee and related records across objects.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Eye, Pencil, Plus, X } from "lucide-react";
import { Button, FieldInput, FormField, Input, Markdown, Modal, ObjectIcon, Select, Textarea } from "../../components/ui";
import { useCurrentUser, useObjects, useOps, useRecordLabel } from "../../app/CrmDataContext";
import { createTask, updateActivity } from "../../ops/activities";
import type { Activity, ActivityTarget, FieldDef } from "../../core/types";
import { toast } from "../../shared/lib/toast";
import { cn } from "../../shared/lib/utils";
import { fromDateTimeInputs, hasCustomTime, toDateInput, toTimeInput } from "./taskUtils";

export interface TaskEditorModalProps {
  open: boolean;
  onClose(): void;
  // Edit this task; create a new one when omitted.
  task?: Activity;
  defaultTargets?: ActivityTarget[];
  defaultAssigneeId?: string;
  // Prefilled title (create mode).
  defaultTitle?: string;
  onSaved?(task: Activity): void;
}

const USER_FIELD: FieldDef = { id: "assignee", label: "", type: "user" };

export function TaskEditorModal({ open, onClose, task, defaultTargets, defaultAssigneeId, defaultTitle, onSaved }: TaskEditorModalProps) {
  const { t } = useTranslation("tasks");
  const ops = useOps();
  const user = useCurrentUser();
  const objects = useObjects();
  const labelOf = useRecordLabel();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [targets, setTargets] = useState<ActivityTarget[]>([]);
  const [pickObject, setPickObject] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? defaultTitle ?? "");
    setBody(task?.body ?? "");
    setPreview(false);
    setDate(toDateInput(task?.dueAt));
    setTime(hasCustomTime(task?.dueAt) ? toTimeInput(task?.dueAt) : "");
    setAssigneeId(task ? task.assigneeId : (defaultAssigneeId ?? user.id));
    const initial = task?.targets ?? defaultTargets ?? [];
    setTargets(initial);
    setPickObject(initial[0]?.object ?? objects[0]?.id ?? "");
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const objectById = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const pickerField = useMemo<FieldDef>(() => ({ id: "x", label: "", type: "relation", relation: { object: pickObject, cardinality: "many" } }), [pickObject]);
  const pickedIds = targets.filter((x) => x.object === pickObject).map((x) => x.id);

  const setPicked = (value: unknown) => {
    const ids = (Array.isArray(value) ? value : value ? [value] : []).map(String);
    setTargets((prev) => {
      const others = prev.filter((x) => x.object !== pickObject);
      const kept = prev.filter((x) => x.object === pickObject && ids.includes(x.id));
      const added = ids.filter((id) => !kept.some((k) => k.id === id)).map((id) => ({ object: pickObject, id }));
      return [...others, ...kept, ...added];
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("editor.titleRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const dueAt = fromDateTimeInputs(date, time);
    try {
      const saved = task
        ? await updateActivity(ops, task.id, { title: title.trim(), body, dueAt: dueAt ?? null, assigneeId: assigneeId ?? null, targets })
        : await createTask(ops, { title: title.trim(), body: body || undefined, dueAt: dueAt ?? null, assigneeId: assigneeId ?? null, targets });
      toast.success(task ? t("toast.updated") : t("toast.created"));
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={task ? t("editor.editTitle") : t("editor.newTitle")} dismissible={false}>
      <form data-form-type="other" onSubmit={(e) => void submit(e)} className="space-y-3 text-[13px]">
        <FormField label={t("editor.title")} htmlFor="task-title" error={error ?? undefined}>
          <Input id="task-title" autoFocus value={title} placeholder={t("editor.titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} invalid={!!error} />
        </FormField>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="task-body" className="text-xs font-medium text-surface-600 dark:text-surface-300">
              {t("editor.description")}
              <span className="ml-1 font-normal text-surface-400">{t("editor.markdownHint")}</span>
            </label>
            <button
              type="button"
              onClick={() => setPreview((p) => !p)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-800 dark:hover:text-surface-100"
            >
              <span className={cn("inline-flex", preview && "hidden")}>
                <Eye className="h-3.5 w-3.5" />
              </span>
              <span className={cn("inline-flex", !preview && "hidden")}>
                <Pencil className="h-3.5 w-3.5" />
              </span>
              <span>{preview ? t("editor.write") : t("editor.preview")}</span>
            </button>
          </div>
          <div className={cn(preview && "hidden")}>
            <Textarea id="task-body" rows={4} value={body} placeholder={t("editor.descriptionPlaceholder")} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className={cn("min-h-[92px] rounded-md border border-surface-200 px-2.5 py-1.5 dark:border-surface-700", !preview && "hidden")}>
            {body.trim() ? <Markdown source={body} /> : <span className="text-sm text-surface-400">{t("editor.nothingToPreview")}</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t("editor.dueDate")} htmlFor="task-due">
            <div className="flex gap-2">
              <Input id="task-due" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-w-0 flex-1" />
              <Input aria-label={t("editor.dueTime")} type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} className="w-28" />
            </div>
          </FormField>
          <FormField label={t("editor.assignee")}>
            <FieldInput field={USER_FIELD} value={assigneeId} onChange={(v) => setAssigneeId(typeof v === "string" ? v : undefined)} placeholder={t("unassigned")} />
          </FormField>
        </div>

        <FormField label={t("editor.related")}>
          <div className="space-y-2">
            {targets.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="task-targets">
                {targets.map((tg) => {
                  const o = objectById.get(tg.object);
                  return (
                    <span key={tg.id} className="inline-flex max-w-full items-center gap-1 rounded border border-surface-200 bg-surface-50 py-0.5 pl-1 pr-0.5 text-xs dark:border-surface-700 dark:bg-surface-800">
                      <ObjectIcon name={o?.icon} color={o?.color} tile className="h-4 w-4" />
                      <span className="truncate">{labelOf(tg.id) ?? tg.id}</span>
                      <button
                        type="button"
                        aria-label={t("editor.removeTarget")}
                        onClick={() => setTargets((prev) => prev.filter((x) => x.id !== tg.id))}
                        className="rounded p-0.5 text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <Select
                aria-label={t("editor.object")}
                className="w-40 shrink-0"
                value={pickObject}
                onChange={(e) => setPickObject(e.target.value)}
                options={objects.map((o) => ({ value: o.id, label: o.labelPlural }))}
              />
              {pickObject && (
                <FieldInput key={pickObject} field={pickerField} value={pickedIds} onChange={setPicked} placeholder={t("editor.addRecord", { object: objectById.get(pickObject)?.labelSingular ?? "" })} className="min-w-0 flex-1" />
              )}
            </div>
          </div>
        </FormField>

        <div className="-mx-5 -mb-4 mt-4 flex items-center justify-end gap-2 border-t border-surface-100 px-5 py-3 dark:border-surface-800">
          <Button variant="ghost" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={task ? <Check /> : <Plus />} loading={saving}>
            {task ? t("editor.save") : t("editor.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
