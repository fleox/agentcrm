// lucide icons by name for module cards (built-in names + the object icon
// set; unknown names fall back to Puzzle).
import { BarChart3, CheckSquare, Database, FileInput, LayoutDashboard, Palette, Plug, Puzzle, Search, Settings, ShieldCheck, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { OBJECT_ICONS } from "../../components/ui";

const ICONS: Record<string, LucideIcon> = { BarChart3, CheckSquare, Database, FileInput, LayoutDashboard, Palette, Plug, Puzzle, Search, Settings, ShieldCheck, Sparkles, Zap };

export function moduleIcon(name: string | undefined): LucideIcon {
  return (name && (ICONS[name] ?? OBJECT_ICONS[name])) || Puzzle;
}
