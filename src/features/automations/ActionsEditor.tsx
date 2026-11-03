// Ordered list of automation actions with type-specific inputs.
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, CheckSquare, Globe, Pencil, StickyNote, Trash2, UserPlus } from "lucide-react";
import type { AutomationAction, CrmUser, ObjectDef } from "../../core/types";
import { Dropdown, Button, FieldInput, FormField, IconButton, Input, Select, Textarea } from "../../components/ui";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

export const PLACEHOLDER_TOKENS = ["{{label}}", "{{owner}}", "{{object}}", "{{today}}"];

const ICONS: Record<AutomationAction["type"], ReactNode> = {
  createTask: <CheckSquare />,
  updateField: <Pencil />,
  addNote: <StickyNote />,
  assignOwner: <UserPlus />,
  webhook: <Globe />,
};

export function newAction(type: AutomationAction["type"], object: ObjectDef | undefined): AutomationAction {
  switch (type) {
    case "createTask":
      return { type, title: "", dueInDays: 1, assignTo: "owner" };
    case "updateField":
      return { type, field: object?.fields.find((f) => !f.system)?.id ?? "", value: undefined };
    case "addNote":
      return { type, body: "" };
    case "assignOwner":
      return { type, userId: "roundRobin" };
    case "webhook":
      return { type, url: "https://" };
  }
}

function PlaceholderHint({ object }: { object: ObjectDef | undefined }) {
  const { t } = useTranslation("automations");
  const fieldTokens = (object?.fields ?? []).filter((f) => !f.hidden).slice(0, 6).map((f) => `{{${f.id}}}`);
  return (
    <p className="text-xs text-surface-500">
      {t("actions.placeholdersHint")}{" "}
      {[...PLACEHOLDER_TOKENS, ...fieldTokens].map((tok) => (
        <code key={tok} className="mr-1 rounded bg-surface-100 px-1 text-[11px] dark:bg-surface-800">
          {tok}
        </code>
      ))}
    </p>
  );
}

function ActionFields({ action, object, users, onChange, disabled }: { action: AutomationAction; object: ObjectDef | undefined; users: CrmUser[]; onChange(a: AutomationAction): void; disabled?: boolean }) {
  const { t } = useTranslation("automations");
  const userOptions = users.filter((u) => !u.disabled && u.role !== "viewer").map((u) => ({ value: u.id, label: u.name }));
  switch (action.type) {
    case "createTask":
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_12rem]">
          <FormField label={t("actions.taskTitle")}>
            <Input value={action.title} disabled={disabled} placeholder={t("actions.taskTitlePlaceholder")} onChange={(e) => onChange({ ...action, title: e.target.value })} />
          </FormField>
          <FormField label={t("actions.dueInDays")}>
            <Input type="number" min={0} value={action.dueInDays ?? ""} disabled={disabled} onChange={(e) => onChange({ ...action, dueInDays: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })} />
          </FormField>
          <FormField label={t("actions.assignTo")}>
            <Select value={action.assignTo ?? "owner"} disabled={disabled} options={[{ value: "owner", label: t("actions.owner") }, ...userOptions]} onChange={(e) => onChange({ ...action, assignTo: e.target.value })} />
          </FormField>
          <div className="sm:col-span-3">
            <PlaceholderHint object={object} />
          </div>
        </div>
      );
    case "updateField": {
      const fields = (object?.fields ?? []).filter((f) => !f.system || f.id === "stage");
      const field = fields.find((f) => f.id === action.field);
      return (
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <FormField label={t("actions.field")}>
            <Select value={action.field} disabled={disabled} options={fields.map((f) => ({ value: f.id, label: f.label }))} onChange={(e) => onChange({ ...action, field: e.target.value, value: undefined })} />
          </FormField>
          <FormField label={t("actions.value")} help={t("actions.valueHint")}>
            {field ? <FieldInput field={{ ...field, required: false }} value={action.value} disabled={disabled} onChange={(v) => onChange({ ...action, value: v })} /> : <Input disabled />}
          </FormField>
        </div>
      );
    }
    case "addNote":
      return (
        <div className="space-y-2">
          <FormField label={t("actions.body")}>
            <Textarea rows={3} value={action.body} disabled={disabled} placeholder={t("actions.bodyPlaceholder")} onChange={(e) => onChange({ ...action, body: e.target.value })} />
          </FormField>
          <PlaceholderHint object={object} />
        </div>
      );
    case "assignOwner":
      return (
        <FormField label={t("actions.user")} className="max-w-sm">
          <Select value={action.userId} disabled={disabled} options={[{ value: "roundRobin", label: t("actions.roundRobin") }, ...userOptions]} onChange={(e) => onChange({ ...action, userId: e.target.value })} />
        </FormField>
      );
    case "webhook":
      return (
        <FormField label={t("actions.url")} help={t("actions.webhookHint")}>
          <Input type="url" value={action.url} disabled={disabled} placeholder="https://hooks.zapier.com/…" onChange={(e) => onChange({ ...action, url: e.target.value })} />
        </FormField>
      );
  }
}

export function ActionsEditor({ object, users, value, onChange, disabled }: { object: ObjectDef | undefined; users: CrmUser[]; value: AutomationAction[]; onChange(next: AutomationAction[]): void; disabled?: boolean }) {
  const { t } = useTranslation("automations");
  const types: AutomationAction["type"][] = ["createTask", "updateField", "addNote", "assignOwner", "webhook"];
  const move = (i: number, d: number) => {
    const next = [...value];
    const [a] = next.splice(i, 1);
    next.splice(i + d, 0, a);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-sm text-surface-500">{t("actions.none")}</p>}
      {value.map((action, i) => (
        <div key={i} className="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300 [&>svg]:h-3.5 [&>svg]:w-3.5">{ICONS[action.type]}</span>
            <span className="text-sm font-medium">
              {i + 1}. {t(`actions.types.${action.type}`)}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <IconButton size="sm" label={t("actions.moveUp")} icon={<ArrowUp />} disabled={disabled || i === 0} onClick={() => move(i, -1)} />
              <IconButton size="sm" label={t("actions.moveDown")} icon={<ArrowDown />} disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} />
              <IconButton size="sm" label={t("actions.remove")} icon={<Trash2 />} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          </div>
          <ActionFields action={action} object={object} users={users} disabled={disabled} onChange={(a) => onChange(value.map((x, j) => (j === i ? a : x)))} />
        </div>
      ))}
      {!disabled && (
        <Dropdown
          trigger={({ ref, onClick }) => (
            <Button ref={ref as never} size="sm" icon={<Plus />} onClick={onClick}>
              {t("actions.add")}
            </Button>
          )}
          items={types.map((type) => ({ id: type, label: t(`actions.types.${type}`), icon: ICONS[type], onSelect: () => onChange([...value, newAction(type, object)]) }))}
        />
      )}
    </div>
  );
}
