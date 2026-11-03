import { type ReactNode } from "react";
import { cn } from "../../shared/lib/utils";
import { Popover, usePopover } from "./Popover";

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?(): void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  // Render a separator before this item.
  separator?: boolean;
  checked?: boolean;
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  return (
    <div role="menu" className="min-w-[180px] py-1">
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div className="my-1 h-px bg-surface-100 dark:bg-surface-800" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4",
              item.danger ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10" : "text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-800",
            )}
          >
            {item.icon && <span className="text-surface-400">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.checked && <span className="text-accent-600">✓</span>}
            {item.shortcut && <kbd className="text-2xs text-surface-400">{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}

// Dropdown menu: `trigger` receives the ref + toggle to attach.
export function Dropdown({
  trigger,
  items,
  align = "start",
  header,
}: {
  trigger: (props: { ref: (el: HTMLElement | null) => void; onClick(): void; open: boolean }) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  header?: ReactNode;
}) {
  const p = usePopover();
  return (
    <>
      {trigger({ ref: p.anchorRef, onClick: p.toggle, open: p.open })}
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} align={align}>
        {header && <div className="border-b border-surface-100 px-3 py-2 dark:border-surface-800">{header}</div>}
        <MenuList items={items} onClose={p.close} />
      </Popover>
    </>
  );
}
