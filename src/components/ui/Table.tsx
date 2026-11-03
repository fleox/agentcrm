import { forwardRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { cn } from "../../shared/lib/utils";

// Dense, Twenty-like table primitives. Compose them; the records feature
// builds its data grid on top.

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(function Table({ className, ...rest }, ref) {
  return <table ref={ref} className={cn("w-full border-separate border-spacing-0 text-[13px]", className)} {...rest} />;
});

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("sticky top-0 z-10 bg-white dark:bg-surface-950", className)} {...rest} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr({ className, selected, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return <tr className={cn("group", selected ? "bg-accent-50/60 dark:bg-accent-500/10" : "hover:bg-surface-50 dark:hover:bg-surface-900", className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-row whitespace-nowrap border-b border-r border-surface-200 px-2 text-left text-xs font-medium text-surface-500 last:border-r-0 dark:border-surface-800",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-row max-w-[320px] truncate border-b border-r border-surface-100 px-2 text-surface-800 last:border-r-0 dark:border-surface-800/70 dark:text-surface-200", className)} {...rest} />;
}
