import { type ReactNode, type HTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn, initials } from "../../shared/lib/utils";
import { chipClass, dotClass } from "./colors";

export function Badge({ children, color = "gray", className, dot }: { children: ReactNode; color?: string; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs font-medium leading-4", chipClass(color), className)}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(color))} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

const AVATAR_COLORS = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-orange-500"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, src, size = "md", square, className }: { name: string; src?: string; size?: "xs" | "sm" | "md" | "lg"; square?: boolean; className?: string }) {
  const dims = { xs: "h-4 w-4 text-[8px]", sm: "h-5 w-5 text-[10px]", md: "h-6 w-6 text-[11px]", lg: "h-9 w-9 text-sm" }[size];
  const shape = square ? "rounded" : "rounded-full";
  if (src) return <img src={src} alt={name} className={cn("shrink-0 object-cover", dims, shape, className)} />;
  return (
    <span className={cn("inline-flex shrink-0 select-none items-center justify-center font-semibold text-white", dims, shape, AVATAR_COLORS[hash(name || "?") % AVATAR_COLORS.length], className)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-surface-900 px-2 py-1 text-xs text-white opacity-0 shadow transition-opacity group-hover/tt:opacity-100 dark:bg-surface-700",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}

export function Spinner({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-3.5 w-3.5", md: "h-5 w-5", lg: "h-8 w-8" }[size];
  return <Loader2 className={cn("animate-spin text-surface-400", dims, className)} aria-label="Loading" />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 text-surface-500 dark:bg-surface-800 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <h3 className="text-sm font-semibold text-surface-900 dark:text-white">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-surface-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true, ...rest }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean } & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <section className={cn("rounded-lg border border-surface-200 bg-white shadow-card dark:border-surface-800 dark:bg-surface-900", className)} {...rest}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-surface-100 px-card py-card-head dark:border-surface-800">
          <h3 className="truncate text-sm font-semibold text-surface-900 dark:text-white">{title}</h3>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && "p-card")}>{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-surface-200 bg-surface-50 px-1 font-sans text-2xs text-surface-500 dark:border-surface-700 dark:bg-surface-800">{children}</kbd>;
}

export function PageHeader({ title, icon, description, actions, children }: { title: ReactNode; icon?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-surface-200 bg-white px-6 py-page dark:border-surface-800 dark:bg-surface-950">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="text-surface-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          <h1 className="truncate text-[15px] font-semibold text-surface-900 dark:text-white">{title}</h1>
          {description && <span className="truncate text-sm text-surface-500">{description}</span>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
