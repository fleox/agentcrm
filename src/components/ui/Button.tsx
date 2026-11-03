import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../shared/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  // Colors from the workspace appearance (--primary*: near-black / white
  // by default, the accent with "accent buttons").
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface-100 text-surface-800 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-100 dark:hover:bg-surface-700",
  outline: "border border-surface-200 bg-white text-surface-800 hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:hover:bg-surface-800 shadow-sm",
  ghost: "text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-white",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-xs gap-1 rounded",
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-sm gap-2 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Leading icon. While `loading`, a spinner replaces it — both live in
  // stable <span> wrappers toggled by class (form crash prevention: no
  // conditional element swaps inside buttons, see CLAUDE.md rule 7).
  icon?: ReactNode;
  loading?: boolean;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", icon, loading = false, trailing, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const hasIcon = !!icon || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {hasIcon && (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
          <span className={cn("inline-flex", loading && "hidden")}>{icon}</span>
          <span className={cn("inline-flex", !loading && "hidden")}>
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        </span>
      )}
      {children !== undefined && children !== null && <span className="truncate">{children}</span>}
      {trailing && <span className="inline-flex shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{trailing}</span>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", variant = "ghost", active, className, type = "button", ...rest },
  ref,
) {
  const dims = size === "xs" ? "h-6 w-6" : size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4",
        dims,
        VARIANTS[variant],
        active && "bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-white",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
