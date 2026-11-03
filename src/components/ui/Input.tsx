import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../shared/lib/utils";

export const inputBase =
  "w-full rounded-md border border-surface-200 bg-white px-2.5 text-sm text-surface-900 placeholder:text-surface-400 shadow-sm transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:placeholder:text-surface-500";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ icon, invalid, className, ...rest }, ref) {
  if (!icon) {
    return <input ref={ref} className={cn(inputBase, "h-8", invalid && "border-red-400 focus:border-red-500 focus:ring-red-500/20", className)} {...rest} />;
  }
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <input ref={ref} className={cn(inputBase, "h-8 pl-8", invalid && "border-red-400")} {...rest} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(inputBase, "py-1.5", invalid && "border-red-400", className)} {...rest} />;
});

export interface SelectOptionItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOptionItem[];
  placeholder?: string;
}

// Native select (accessible, mobile-friendly). For colored option chips
// with search use FieldInput / Combobox.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, placeholder, className, ...rest }, ref) {
  return (
    <div className={cn("relative", className)}>
      <select ref={ref} className={cn(inputBase, "h-8 appearance-none pr-8")} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
    </div>
  );
});

export function Label({ children, htmlFor, className, hint }: { children: ReactNode; htmlFor?: string; className?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1 block text-xs font-medium text-surface-600 dark:text-surface-300", className)}>
      {children}
      {hint && <span className="ml-1 font-normal text-surface-400">{hint}</span>}
    </label>
  );
}

export function FormField({ label, htmlFor, error, help, children, className }: { label?: ReactNode; htmlFor?: string; error?: ReactNode; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : help ? <p className="text-xs text-surface-500">{help}</p> : null}
    </div>
  );
}
