// Global overlay: opens the task editor on the "tasks.create" shell event
// (detail { targets?: ActivityTarget[]; title?: string }) from anywhere —
// command palette, record pages, other features.

import { useState } from "react";
import { useShellEvent } from "../../app/shellEvents";
import type { ActivityTarget } from "../../core/types";
import { TaskEditorModal } from "./TaskEditorModal";

export interface TaskCreateEventDetail {
  targets?: ActivityTarget[];
  title?: string;
}

export function TaskCreateOverlay() {
  const [state, setState] = useState<{ key: number; detail: TaskCreateEventDetail } | null>(null);
  useShellEvent("tasks.create", (detail) => {
    const d = (detail && typeof detail === "object" ? detail : {}) as TaskCreateEventDetail;
    setState((s) => ({ key: (s?.key ?? 0) + 1, detail: { targets: Array.isArray(d.targets) ? d.targets : undefined, title: typeof d.title === "string" ? d.title : undefined } }));
  });
  if (!state) return null;
  return <TaskEditorModal key={state.key} open onClose={() => setState(null)} defaultTargets={state.detail.targets} defaultTitle={state.detail.title} />;
}
