// Log activity composer: note / call / email / meeting / task (with due
// date & assignee). Writes through ops/activities.addActivity.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import type { ActivityTarget, ActivityType } from "../../../core/types";
import { Button, FieldInput, Input, Select } from "../../../components/ui";
import { useCan, useCurrentUser, useOps } from "../../../app/CrmDataContext";
import { addActivity } from "../../../ops/activities";
import { toast } from "../../../shared/lib/toast";
import { cn } from "../../../shared/lib/utils";
import { ACTIVITY_ICONS, ACTIVITY_TONES } from "./activityStyle";
import { MarkdownEditor } from "./MarkdownEditor";

export const COMPOSER_TYPES: ActivityType[] = ["note", "call", "email", "meeting", "task"];

function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ActivityComposer({ targets, defaultType = "note", types = COMPOSER_TYPES, onDone, autoFocus }: { targets: ActivityTarget[]; defaultType?: ActivityType; types?: ActivityType[]; onDone?(): void; autoFocus?: boolean }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const me = useCurrentUser();
  const canWrite = useCan("activities.write");
  const [type, setType] = useState<ActivityType>(defaultType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState<string | undefined>(me.id);
  const [duration, setDuration] = useState("15");
  const [outcome, setOutcome] = useState("connected");
  const [direction, setDirection] = useState("outbound");
  const [start, setStart] = useState(() => localInput(Date.now()));
  const [length, setLength] = useState("30");
  const [busy, setBusy] = useState(false);
  if (!canWrite) return null;

  const reset = () => {
    setTitle("");
    setBody("");
    setDue("");
  };

  const submit = async () => {
    if (!title.trim() && !body.trim()) {
      toast.error(t("composer.empty"));
      return;
    }
    setBusy(true);
    try {
      const meta: Record<string, unknown> = {};
      let dueAt: string | number | undefined;
      if (type === "call") Object.assign(meta, { durationMin: Number(duration) || 0, outcome, direction });
      if (type === "email") Object.assign(meta, { direction });
      if (type === "meeting") {
        const s = new Date(start).getTime();
        if (Number.isFinite(s)) Object.assign(meta, { startAt: s, endAt: s + (Number(length) || 30) * 60_000 });
      }
      if (type === "task" && due) dueAt = due;
      await addActivity(ops, {
        type,
        title: title.trim() || (type === "note" ? "" : t(`composer.defaultTitle.${type}`)),
        body: body.trim() || undefined,
        targets,
        ...(dueAt ? { dueAt } : {}),
        ...(type === "task" ? { assigneeId: assignee ?? null } : {}),
        ...(Object.keys(meta).length ? { meta } : {}),
      });
      toast.success(t("composer.logged", { type: tc(`activityTypes.${type}`) }));
      reset();
      onDone?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      data-form-type="other"
      data-testid="activity-composer"
      className="space-y-2 rounded-lg border border-surface-200 bg-white p-2.5 shadow-card dark:border-surface-800 dark:bg-surface-900"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {types.length > 1 && (
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("composer.type")}>
          {types.map((ty) => {
            const Icon = ACTIVITY_ICONS[ty];
            return (
              <button
                key={ty}
                type="button"
                role="tab"
                aria-selected={type === ty}
                onClick={() => setType(ty)}
                className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium", type === ty ? ACTIVITY_TONES[ty] : "text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800")}
              >
                <Icon className="h-3.5 w-3.5" />
                {tc(`activityTypes.${ty}`)}
              </button>
            );
          })}
        </div>
      )}
      <Input aria-label={t("composer.title")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(`composer.titlePlaceholder.${type}`)} autoFocus={autoFocus} />
      {type === "call" && (
        <div className="grid grid-cols-3 gap-2">
          <Input aria-label={t("composer.duration")} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t("composer.duration")} />
          <Select aria-label={t("composer.outcome")} value={outcome} onChange={(e) => setOutcome(e.target.value)} options={["connected", "voicemail", "noAnswer", "busy"].map((o) => ({ value: o, label: t(`composer.outcomes.${o}`) }))} />
          <Select aria-label={t("composer.direction")} value={direction} onChange={(e) => setDirection(e.target.value)} options={["outbound", "inbound"].map((o) => ({ value: o, label: t(`composer.directions.${o}`) }))} />
        </div>
      )}
      {type === "email" && (
        <Select aria-label={t("composer.direction")} value={direction} onChange={(e) => setDirection(e.target.value)} options={["outbound", "inbound"].map((o) => ({ value: o, label: t(`composer.directions.${o}`) }))} />
      )}
      {type === "meeting" && (
        <div className="grid grid-cols-2 gap-2">
          <Input type="datetime-local" aria-label={t("composer.start")} value={start} onChange={(e) => setStart(e.target.value)} />
          <Select aria-label={t("composer.length")} value={length} onChange={(e) => setLength(e.target.value)} options={["15", "30", "45", "60", "90", "120"].map((m) => ({ value: m, label: t("composer.minutes", { count: Number(m) }) }))} />
        </div>
      )}
      {type === "task" && (
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" aria-label={t("composer.due")} value={due} onChange={(e) => setDue(e.target.value)} />
          <FieldInput field={{ id: "assignee", label: t("composer.assignee"), type: "user" }} value={assignee} onChange={(v) => setAssignee(v as string | undefined)} />
        </div>
      )}
      <MarkdownEditor value={body} onChange={setBody} rows={type === "note" ? 4 : 3} placeholder={t(`composer.bodyPlaceholder.${type}`)} onSubmit={() => void submit()} label={t("composer.body")} />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-2xs text-surface-400">{t("composer.submitHint")}</span>
        <Button type="submit" size="sm" variant="primary" loading={busy} icon={<Send />}>
          {t("composer.submit", { type: tc(`activityTypes.${type}`) })}
        </Button>
      </div>
    </form>
  );
}
