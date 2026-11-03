// Human-readable summaries of triggers and actions (translated).
import { getAutomationAction } from "../../ops/automations/extensionActions";
import { useTranslation } from "react-i18next";
import { formatFieldValue } from "../../core/fields";
import { resolveField } from "../../core/query";
import type { Automation, AutomationAction, CrmUser, FilterOp, ObjectDef, Pipeline } from "../../core/types";

export const OP_KEYS: FilterOp[] = ["eq", "neq", "contains", "notContains", "empty", "notEmpty", "gt", "gte", "lt", "lte", "in", "notIn", "before", "after", "withinDays"];
export const NO_VALUE_OPS: FilterOp[] = ["empty", "notEmpty"];

export function stageLabel(pipelines: Pipeline[], value: unknown, t: (k: string) => string): string {
  const v = String(value ?? "");
  const stage = pipelines.flatMap((p) => p.stages).find((s) => s.id === v);
  if (stage) return stage.label;
  if (v === "won" || v === "lost" || v === "open") return t(`trigger.${v}Kind`);
  return v;
}

export function useAutomationLabels(objects: ObjectDef[], pipelines: Pipeline[], users: CrmUser[]) {
  const { t } = useTranslation("automations");
  const objectOf = (id: string) => objects.find((o) => o.id === id);

  const triggerSummary = (a: Pick<Automation, "object" | "trigger">): string => {
    const object = objectOf(a.object);
    const objectLabel = object?.labelSingular.toLowerCase() ?? a.object;
    const tr = a.trigger;
    const field = tr.field && object ? resolveField(object, tr.field) : undefined;
    const fieldLabel = field?.label ?? tr.field ?? "";
    switch (tr.type) {
      case "record.created":
        return t("trigger.summary.created", { object: objectLabel });
      case "record.updated":
        return tr.field ? t("trigger.summary.updatedField", { object: objectLabel, field: fieldLabel }) : t("trigger.summary.updated", { object: objectLabel });
      case "field.changed": {
        if (tr.to === undefined || tr.to === null || tr.to === "") return t("trigger.summary.fieldChanged", { field: fieldLabel });
        const value = field ? formatFieldValue(field, tr.to, { userName: (id) => users.find((u) => u.id === id)?.name }) || String(tr.to) : String(tr.to);
        return t("trigger.summary.fieldChangedTo", { field: fieldLabel, value });
      }
      case "stage.changed":
        return tr.to ? t("trigger.summary.stageChangedTo", { value: stageLabel(pipelines, tr.to, t) }) : t("trigger.summary.stageChanged");
      case "schedule":
        return t("trigger.summary.schedule", { count: tr.everyHours ?? 24 });
      case "inactivity":
        return t("trigger.summary.inactivity", { count: tr.days ?? 14, object: objectLabel });
    }
  };

  const actionSummary = (action: AutomationAction, objectId: string): string => {
    const object = objectOf(objectId);
    switch (action.type) {
      case "createTask":
        return t("actions.summary.createTask", { title: action.title });
      case "updateField":
        return t("actions.summary.updateField", { field: (object && resolveField(object, action.field)?.label) ?? action.field });
      case "addNote":
        return t("actions.summary.addNote");
      case "assignOwner":
        return action.userId === "roundRobin" ? t("actions.summary.roundRobin") : t("actions.summary.assignOwner", { user: users.find((u) => u.id === action.userId)?.name ?? action.userId });
      case "webhook":
        return t("actions.summary.webhook", { url: action.url.replace(/^https?:\/\//, "").slice(0, 40) });
      case "extension": {
        const def = getAutomationAction(action.action);
        return def ? t(def.label) : action.action;
      }
    }
  };

  return { triggerSummary, actionSummary };
}

export function statusColor(status: string): string {
  return status === "ok" ? "green" : status === "error" ? "red" : "gray";
}
