// Small building blocks of the customisation sections.

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { cn } from "../../shared/lib/utils";

export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-surface-900 dark:text-white">{title}</h2>
        {description && <p className="mt-0.5 max-w-2xl text-[13px] text-surface-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ReadOnlyNotice() {
  const { t } = useTranslation("customize");
  return (
    <div className="flex items-center gap-2 rounded-md border border-surface-200 bg-surface-50 px-3 py-2 text-xs text-surface-600 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-300">
      <Lock className="h-3.5 w-3.5 shrink-0" />
      {t("readOnly")}
    </div>
  );
}

// A row of mutually exclusive buttons (radio group).
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange(v: T): void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-surface-200 bg-surface-50 p-0.5 dark:border-surface-700 dark:bg-surface-900">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:cursor-not-allowed disabled:opacity-60",
              active ? "bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white" : "text-surface-500 hover:text-surface-900 dark:hover:text-white",
            )}
          >
            {o.icon && <span className="inline-flex [&>svg]:h-3.5 [&>svg]:w-3.5">{o.icon}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Label + hint on the left, control on the right (stacks on mobile).
export function SettingRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-surface-100 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between dark:border-surface-800">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-surface-900 dark:text-white">{label}</div>
        {hint && <div className="text-xs text-surface-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
