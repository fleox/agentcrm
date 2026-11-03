import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../shared/lib/utils";
import { IconButton } from "./Button";

// Escape closes the top-most overlay only.
const stack: Array<() => void> = [];

export function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    const close = () => ref.current();
    stack.push(close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === close) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.indexOf(close);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  // Disable closing on backdrop click (forms with unsaved input).
  dismissible?: boolean;
  className?: string;
}

const MODAL_SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export function Modal({ open, onClose, title, description, children, footer, size = "md", dismissible = true, className }: ModalProps) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
        <div className="fixed inset-0 animate-fade-in bg-black/40 backdrop-blur-[1px]" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
        <div
          role="dialog"
          aria-modal="true"
          className={cn("relative w-full animate-scale-in rounded-xl border border-surface-200 bg-white shadow-pop dark:border-surface-800 dark:bg-surface-900", MODAL_SIZES[size], className)}
        >
          {(title || description) && (
            <div className="flex items-start justify-between gap-4 border-b border-surface-100 px-5 py-4 dark:border-surface-800">
              <div className="min-w-0">
                {title && <h2 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h2>}
                {description && <p className="mt-0.5 text-sm text-surface-500">{description}</p>}
              </div>
              <IconButton label="Close" icon={<X />} size="sm" onClick={onClose} />
            </div>
          )}
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-surface-100 px-5 py-3 dark:border-surface-800">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  side?: "right" | "left";
  actions?: ReactNode;
}

const DRAWER_WIDTHS = { sm: "w-[360px]", md: "w-[480px]", lg: "w-[680px]" };

export function Drawer({ open, onClose, title, children, footer, width = "md", side = "right", actions }: DrawerProps) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-40">
        <div className="absolute inset-0 animate-fade-in bg-black/20" onClick={onClose} aria-hidden="true" />
        <aside
          role="dialog"
          aria-modal="true"
          className={cn(
            "absolute top-0 flex h-full max-w-full animate-slide-in-right flex-col border-surface-200 bg-white shadow-pop dark:border-surface-800 dark:bg-surface-900",
            side === "right" ? "right-0 border-l" : "left-0 border-r",
            DRAWER_WIDTHS[width],
          )}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-surface-100 px-4 dark:border-surface-800">
            <div className="min-w-0 truncate text-sm font-semibold text-surface-900 dark:text-white">{title}</div>
            <div className="flex items-center gap-1">
              {actions}
              <IconButton label="Close" icon={<X />} size="sm" onClick={onClose} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-surface-100 px-4 py-3 dark:border-surface-800">{footer}</div>}
        </aside>
      </div>
    </Portal>
  );
}
