import { Check, Star } from "lucide-react";
import { formatAddress, formatCurrency, formatFieldValue, formatNumber, isEmptyFieldValue, dateValueToMs } from "../../core/fields";
import type { AddressValue, FieldDef } from "../../core/types";
import { cn } from "../../shared/lib/utils";
import { Avatar, Badge } from "./Display";
import { useFieldContext } from "./fieldContext";
import { FileFieldValue } from "./files/FileFields";
import { RecordAvatar } from "./files/RecordAvatar";

export interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  // Single line, truncated (table cells, kanban cards).
  compact?: boolean;
  className?: string;
  // Text shown for empty values ("" by default).
  emptyText?: string;
}

function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

// Renders any stored field value according to its type.
export function FieldValue({ field, value, compact, className, emptyText = "" }: FieldValueProps) {
  const ctx = useFieldContext();
  if (isEmptyFieldValue(field, value)) return emptyText ? <span className={cn("text-surface-400", className)}>{emptyText}</span> : null;
  const wrap = cn(compact ? "flex min-w-0 items-center gap-1 overflow-hidden" : "flex flex-wrap items-center gap-1", className);

  switch (field.type) {
    case "select": {
      const opt = field.options?.find((o) => o.id === value);
      return (
        <span className={wrap}>
          <Badge color={opt?.color}>{opt?.label ?? String(value)}</Badge>
        </span>
      );
    }
    case "multiSelect": {
      const ids = Array.isArray(value) ? value : [value];
      return (
        <span className={wrap}>
          {ids.map((id) => {
            const opt = field.options?.find((o) => o.id === id);
            return (
              <Badge key={String(id)} color={opt?.color}>
                {opt?.label ?? String(id)}
              </Badge>
            );
          })}
        </span>
      );
    }
    case "tags":
      return (
        <span className={wrap}>
          {(Array.isArray(value) ? value : [value]).map((t) => (
            <Badge key={String(t)} color="gray">
              {String(t)}
            </Badge>
          ))}
        </span>
      );
    case "relation": {
      const ids = (Array.isArray(value) ? value : [value]).map(String);
      const target = field.relation?.object ?? "";
      return (
        <span className={wrap}>
          {ids.map((id) => (
            <a
              key={id}
              href={ctx.recordHref(target, id)}
              onClick={stop}
              className="inline-flex max-w-full items-center gap-1 truncate rounded border border-surface-200 bg-white px-1.5 py-px text-xs text-surface-700 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:hover:bg-surface-800"
            >
              <RecordAvatar recordId={id} name={ctx.recordLabel(id) ?? "?"} size="xs" square={target === "companies"} />
              <span className="truncate">{ctx.recordLabel(id) ?? id}</span>
            </a>
          ))}
        </span>
      );
    }
    case "user": {
      const user = ctx.users.find((u) => u.id === value);
      return (
        <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
          <Avatar name={user?.name ?? String(value)} src={user?.avatarUrl} size="sm" />
          <span className="truncate">{user?.name ?? String(value)}</span>
        </span>
      );
    }
    case "boolean":
      return value ? <Check className={cn("h-4 w-4 text-emerald-600", className)} aria-label="Yes" /> : <span className={cn("text-surface-400", className)}>—</span>;
    case "rating":
      return (
        <span className={cn("inline-flex items-center", className)} aria-label={`${value} / 5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={cn("h-3.5 w-3.5", i <= Number(value) ? "fill-amber-400 text-amber-400" : "text-surface-300 dark:text-surface-600")} />
          ))}
        </span>
      );
    case "email":
      return (
        <a href={`mailto:${value}`} onClick={stop} className={cn("truncate text-surface-800 underline-offset-2 hover:underline dark:text-surface-100", className)}>
          {String(value)}
        </a>
      );
    case "phone":
      return (
        <a href={`tel:${String(value).replace(/[^\d+]/g, "")}`} onClick={stop} className={cn("truncate hover:underline", className)}>
          {String(value)}
        </a>
      );
    case "url": {
      const href = String(value);
      const display = href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" onClick={stop} className={cn("truncate text-accent-700 hover:underline dark:text-accent-300", className)}>
          {display}
        </a>
      );
    }
    case "currency":
      return <span className={cn("tabular-nums", className)}>{typeof value === "number" ? formatCurrency(value, field.currency ?? ctx.currency, ctx.locale) : String(value)}</span>;
    case "number":
      return <span className={cn("tabular-nums", className)}>{typeof value === "number" ? formatNumber(value, ctx.locale) : String(value)}</span>;
    case "percent":
      return <span className={cn("tabular-nums", className)}>{typeof value === "number" ? `${formatNumber(value, ctx.locale)}%` : String(value)}</span>;
    case "date":
    case "datetime": {
      const ms = dateValueToMs(value);
      return (
        <span className={cn("tabular-nums", className)} title={ms ? new Date(ms).toLocaleString(ctx.locale) : undefined}>
          {formatFieldValue(field, value, { locale: ctx.locale })}
        </span>
      );
    }
    case "address":
      return <span className={cn(compact ? "truncate" : "whitespace-pre-line", className)}>{formatAddress(value as AddressValue)}</span>;
    case "image":
    case "files":
      return <FileFieldValue field={field} value={value} compact={compact} className={className} />;
    case "longText":
      return <span className={cn(compact ? "truncate" : "whitespace-pre-wrap", className)}>{String(value)}</span>;
    default:
      return <span className={cn("truncate", className)}>{formatFieldValue(field, value, { locale: ctx.locale, currency: ctx.currency })}</span>;
  }
}
