// Inline editor floating over a grid cell / field row. Commits through
// FieldInput's onCommit; closes on Escape or a click elsewhere in the app
// (clicks inside portals — pickers, popovers — don't count).

import { useEffect, useRef } from "react";
import type { FieldDef } from "../../../core/types";
import { FieldInput } from "../../../components/ui";
import { cn } from "../../../shared/lib/utils";

function topLevel(node: Node | null): Node | null {
  let n = node;
  while (n && n.parentNode && n.parentNode !== document.body) n = n.parentNode;
  return n;
}

// Types whose editor commits on every change (pickers) vs on Enter / blur.
const IMMEDIATE = new Set(["select", "multiSelect", "relation", "user", "rating", "boolean", "date", "datetime", "tags"]);
// Editors that stay open after a change (several values).
const MULTI = new Set(["multiSelect", "tags", "address"]);

export function CellEditor({
  field,
  value,
  onCommit,
  onClose,
  className,
}: {
  field: FieldDef;
  value: unknown;
  onCommit(value: unknown): void;
  onClose(): void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef<{ value: unknown; dirty: boolean }>({ value, dirty: false });
  const closed = useRef(false);
  const many = MULTI.has(field.type) || (field.type === "relation" && field.relation?.cardinality === "many");

  const finish = (commit: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (commit && latest.current.dirty) onCommit(latest.current.value);
    onClose();
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current || ref.current.contains(target)) return;
      // Inside a portal (picker panel): not an outside click.
      if (topLevel(target) !== topLevel(ref.current)) return;
      finish(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      data-testid="cell-editor"
      className={cn("rounded-md border border-accent-500 bg-white p-0.5 shadow-pop ring-2 ring-accent-500/20 dark:bg-surface-900", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === "Tab") {
          e.preventDefault();
          finish(true);
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <FieldInput
        field={field}
        value={value}
        autoFocus
        className="border-0 shadow-none focus:ring-0"
        onChange={(v) => {
          latest.current = { value: v, dirty: true };
        }}
        onCommit={(v) => {
          latest.current = { value: v, dirty: true };
          if (IMMEDIATE.has(field.type) && many) {
            // Keep the editor open for multi-value pickers; save now.
            onCommit(v);
            latest.current.dirty = false;
            return;
          }
          finish(true);
        }}
        onCancel={() => finish(false)}
      />
    </div>
  );
}
