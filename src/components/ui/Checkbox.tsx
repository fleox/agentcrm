import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../shared/lib/utils";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, indeterminate, className, ...rest }, ref) {
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const input = (
    <input
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded border-surface-300 text-accent-600 accent-accent-600 focus:ring-2 focus:ring-accent-500/30 dark:border-surface-600 dark:bg-surface-900",
        !label && className,
      )}
      {...rest}
    />
  );
  if (!label) return input;
  return (
    <label className={cn("relative inline-flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-surface-200", className)}>
      {input}
      <span>{label}</span>
    </label>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled, size = "md", className, id }: SwitchProps) {
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const shift = size === "sm" ? "translate-x-3" : "translate-x-4";
  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:opacity-50",
        track,
        checked ? "bg-accent-600" : "bg-surface-300 dark:bg-surface-700",
      )}
    >
      <span className={cn("inline-block rounded-full bg-white shadow transition-transform", knob, checked ? shift : "translate-x-0")} />
    </button>
  );
  if (!label) return <span className={className}>{button}</span>;
  return (
    <label className={cn("relative inline-flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-surface-200", className)}>
      {button}
      <span>{label}</span>
    </label>
  );
}
