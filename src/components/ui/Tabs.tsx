import { type ReactNode } from "react";
import { cn } from "../../shared/lib/utils";

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

export function Tabs({ tabs, value, onChange, className }: { tabs: TabItem[]; value: string; onChange(id: string): void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-800", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4",
              active ? "border-surface-900 text-surface-900 dark:border-white dark:text-white" : "border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200",
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && <span className="rounded bg-surface-100 px-1 text-2xs text-surface-500 dark:bg-surface-800">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
