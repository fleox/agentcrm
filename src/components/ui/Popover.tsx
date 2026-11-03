import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../shared/lib/utils";
import { Portal } from "./Overlay";

// Anchored floating panel rendered in a portal (never clipped by
// overflow-hidden tables). Closes on outside click / Escape.
// Popovers nest: a popover opened from inside another one (e.g. a select
// picker inside the bulk "Update field" panel) is rendered in its own portal,
// so a click in the child must not count as an outside click for the parent,
// and Escape closes the innermost one only.

const PopoverParent = createContext<string | null>(null);

// True when `target` sits in the panel `id` or in a popover nested under it.
export function isInsidePopover(target: Node | null, id: string): boolean {
  let el: Element | null = target instanceof Element ? target : (target?.parentElement ?? null);
  let panel = el?.closest("[data-popover-id]") ?? null;
  while (panel) {
    if (panel.getAttribute("data-popover-id") === id) return true;
    const parent = panel.getAttribute("data-popover-parent");
    if (!parent) return false;
    el = document.querySelector(`[data-popover-id="${CSS.escape(parent)}"]`);
    panel = el;
  }
  return false;
}

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  anchor: HTMLElement | null;
  children: ReactNode;
  align?: "start" | "end";
  // Match the anchor's width (selects, pickers).
  matchWidth?: boolean;
  className?: string;
  offset?: number;
}

export function Popover({ open, onClose, anchor, children, align = "start", matchWidth, className, offset = 4 }: PopoverProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const parentId = useContext(PopoverParent);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = useCallback(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = panel.current?.offsetWidth ?? 220;
    const height = panel.current?.offsetHeight ?? 0;
    let left = align === "end" ? r.right - (matchWidth ? r.width : width) : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - (matchWidth ? r.width : width) - 8));
    let top = r.bottom + offset;
    if (height && top + height > window.innerHeight - 8 && r.top - height - offset > 8) top = r.top - height - offset;
    setPos({ top, left, width: r.width });
  }, [anchor, align, matchWidth, offset]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor?.contains(t) || isInsidePopover(t, id)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A nested popover is open: it closes first.
        if (document.querySelector(`[data-popover-parent="${CSS.escape(id)}"]`)) return;
        e.stopPropagation();
        onClose();
      }
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    // Second pass once the panel has its real size.
    const raf = requestAnimationFrame(place);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, onClose, anchor, place, id]);

  if (!open || !anchor) return null;
  return (
    <Portal>
      <div
        ref={panel}
        data-popover-id={id}
        data-popover-parent={parentId ?? undefined}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, ...(matchWidth && pos ? { minWidth: pos.width } : {}) }}
        className={cn(
          "fixed z-[60] animate-scale-in overflow-hidden rounded-lg border border-surface-200 bg-white shadow-pop dark:border-surface-700 dark:bg-surface-900",
          className,
        )}
      >
        <PopoverParent.Provider value={id}>{children}</PopoverParent.Provider>
      </div>
    </Portal>
  );
}

export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return {
    anchorRef: setAnchor as (el: HTMLElement | null) => void,
    anchor,
    open,
    setOpen,
    toggle: () => setOpen((o) => !o),
    close: () => setOpen(false),
  };
}
