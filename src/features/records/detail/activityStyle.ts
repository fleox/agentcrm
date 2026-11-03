import { CalendarDays, CheckSquare, Mail, Phone, StickyNote, type LucideIcon } from "lucide-react";
import type { ActivityType } from "../../../core/types";

export const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  note: StickyNote,
  task: CheckSquare,
  call: Phone,
  email: Mail,
  meeting: CalendarDays,
};

export const ACTIVITY_TONES: Record<ActivityType, string> = {
  note: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  task: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
  call: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  email: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200",
  meeting: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-200",
};
