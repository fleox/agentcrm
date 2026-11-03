// Saved views of an object as tabs, with create / rename / duplicate /
// share / delete.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Kanban, MoreHorizontal, Pencil, Plus, Share2, Table2, Trash2, Lock } from "lucide-react";
import type { ObjectDef, Pipeline, ViewDef } from "../../../core/types";
import { Button, confirmDialog, Dropdown, FormField, Input, Modal, Select } from "../../../components/ui";
import { useCan, useOps } from "../../../app/CrmDataContext";
import { createView, deleteView, duplicateView, updateView } from "../../../ops/views";
import { cn } from "../../../shared/lib/utils";
import { useRun } from "../lib/hooks";
import { groupableFields } from "../lib/viewModel";

interface ViewFormValue {
  name: string;
  type: ViewDef["type"];
  groupBy?: string;
  shared: boolean;
}

function ViewFormModal({ open, onClose, title, initial, object, pipelines, onSubmit, showType }: { open: boolean; onClose(): void; title: string; initial: ViewFormValue; object: ObjectDef; pipelines: Pipeline[]; onSubmit(v: ViewFormValue): Promise<void>; showType: boolean }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const canShare = useCan("views.writeShared");
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const groupable = groupableFields(object);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <form
        data-form-type="other"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.name.trim()) return;
          setBusy(true);
          try {
            await onSubmit(value);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label={t("views.name")} htmlFor="view-name">
          <Input id="view-name" autoFocus value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} />
        </FormField>
        {showType && (
          <FormField label={t("options.layout")}>
            <Select
              aria-label={t("options.layout")}
              value={value.type}
              onChange={(e) => {
                const type = e.target.value as ViewDef["type"];
                setValue({ ...value, type, groupBy: type === "kanban" ? value.groupBy ?? pipelines[0]?.stageField ?? groupable[0]?.id : undefined });
              }}
              options={[
                { value: "table", label: t("options.table") },
                ...(groupable.length ? [{ value: "kanban", label: t("options.kanban") }] : []),
              ]}
            />
          </FormField>
        )}
        {showType && value.type === "kanban" && (
          <FormField label={t("options.groupBy")}>
            <Select aria-label={t("options.groupBy")} value={value.groupBy ?? ""} onChange={(e) => setValue({ ...value, groupBy: e.target.value })} options={groupable.map((f) => ({ value: f.id, label: f.label }))} />
          </FormField>
        )}
        {canShare && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.shared} onChange={(e) => setValue({ ...value, shared: e.target.checked })} className="h-4 w-4 accent-accent-600" />
            {t("views.sharedHint")}
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!value.name.trim()} icon={<Plus />}>
            {tc("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ViewTabs({ object, views, current, draft, pipelines, onSelect }: { object: ObjectDef; views: ViewDef[]; current: ViewDef | undefined; draft: ViewDef; pipelines: Pipeline[]; onSelect(id: string): void }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const run = useRun();
  const canOwn = useCan("views.writeOwn");
  const canShared = useCan("views.writeShared");
  const [modal, setModal] = useState<null | "create" | "rename">(null);
  const canEdit = (v: ViewDef) => (v.shared ? canShared : canOwn);

  const create = async (v: ViewFormValue) => {
    const pipeline = v.type === "kanban" ? pipelines.find((p) => p.stageField === v.groupBy) : undefined;
    const created = await run(() =>
      createView(ops, {
        object: object.id,
        name: v.name,
        type: v.type,
        columns: draft.columns,
        filters: draft.filters,
        sorts: draft.sorts,
        groupBy: v.type === "kanban" ? v.groupBy : undefined,
        pipelineId: pipeline?.id,
        shared: v.shared,
      }),
      t("views.created"),
    );
    if (created) {
      setModal(null);
      onSelect(created.id);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label={t("views.title")}>
      {views.map((v) => {
        const active = v.id === current?.id;
        const Icon = v.type === "kanban" ? Kanban : Table2;
        return (
          <div key={v.id} className={cn("group flex shrink-0 items-center rounded-md", active ? "bg-surface-100 dark:bg-surface-800" : "hover:bg-surface-50 dark:hover:bg-surface-900")}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(v.id)}
              className={cn("flex h-7 items-center gap-1.5 px-2 text-[13px] font-medium", active ? "text-surface-900 dark:text-white" : "text-surface-500 hover:text-surface-800 dark:hover:text-surface-200")}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="max-w-[160px] truncate">{v.name}</span>
              {!v.shared && <Lock className="h-3 w-3 text-surface-400" aria-label={t("views.private")} />}
            </button>
            {active && (
              <Dropdown
                align="start"
                trigger={({ ref, onClick }) => (
                  <button ref={ref as never} type="button" onClick={onClick} aria-label={t("views.menu")} className="mr-0.5 flex h-5 w-5 items-center justify-center rounded text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                )}
                items={[
                  { id: "rename", label: t("views.rename"), icon: <Pencil />, disabled: !canEdit(v), onSelect: () => setModal("rename") },
                  {
                    id: "duplicate",
                    label: t("views.duplicate"),
                    icon: <Copy />,
                    disabled: !canOwn,
                    onSelect: async () => {
                      const copy = await run(() => duplicateView(ops, v.id, t("views.copyName", { name: v.name })), t("views.created"));
                      if (copy) onSelect(copy.id);
                    },
                  },
                  ...(canShared
                    ? [{ id: "share", label: v.shared ? t("views.makePrivate") : t("views.share"), icon: <Share2 />, onSelect: () => void run(() => updateView(ops, v.id, { shared: !v.shared })) }]
                    : []),
                  {
                    id: "delete",
                    label: t("views.delete"),
                    icon: <Trash2 />,
                    danger: true,
                    separator: true,
                    disabled: !canEdit(v) || views.length <= 1,
                    onSelect: async () => {
                      if (!(await confirmDialog({ title: tc("confirm.deleteTitle", { name: v.name }), danger: true, confirmLabel: tc("common.delete") }))) return;
                      const ok = await run(() => deleteView(ops, v.id), t("views.deleted"));
                      if (ok) onSelect(views.find((x) => x.id !== v.id)!.id);
                    },
                  },
                ]}
              />
            )}
          </div>
        );
      })}
      {canOwn && (
        <button type="button" onClick={() => setModal("create")} aria-label={t("views.new")} title={t("views.new")} className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800">
          <Plus className="h-4 w-4" />
        </button>
      )}
      {modal === "create" && (
        <ViewFormModal
          open
          showType
          title={t("views.new")}
          object={object}
          pipelines={pipelines}
          initial={{ name: "", type: draft.type, groupBy: draft.groupBy, shared: false }}
          onClose={() => setModal(null)}
          onSubmit={create}
        />
      )}
      {modal === "rename" && current && (
        <ViewFormModal
          open
          showType={false}
          title={t("views.rename")}
          object={object}
          pipelines={pipelines}
          initial={{ name: current.name, type: current.type, groupBy: current.groupBy, shared: current.shared }}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const ok = await run(() => updateView(ops, current.id, { name: v.name, ...(canShared ? { shared: v.shared } : {}) }), t("views.saved"));
            if (ok) setModal(null);
          }}
        />
      )}
    </div>
  );
}
