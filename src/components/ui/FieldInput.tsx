import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search, Star, X } from "lucide-react";
import { parseNumber, toIsoDate } from "../../core/fields";
import type { AddressValue, FieldDef, SelectOption } from "../../core/types";
import { cn } from "../../shared/lib/utils";
import { Avatar, Badge } from "./Display";
import { Checkbox } from "./Checkbox";
import { useFieldContext } from "./fieldContext";
import { Input, inputBase, Textarea } from "./Input";
import { Popover, usePopover } from "./Popover";
import { chipClass, dotClass } from "./colors";

export interface FieldInputProps {
  field: FieldDef;
  value: unknown;
  // Called with the new value in storage format (undefined = cleared).
  // Text-like inputs call it on every keystroke; pair with onCommit for
  // inline editing.
  onChange(value: unknown): void;
  // Enter / blur / picker selection — inline editors save here.
  onCommit?(value: unknown): void;
  onCancel?(): void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}

// Edits any field value by type. Values are emitted in storage format
// (see core/fields.ts); ops/records.ts still validates on save.
export function FieldInput(props: FieldInputProps) {
  const { field } = props;
  switch (field.type) {
    case "longText":
      return <LongTextInput {...props} />;
    case "number":
    case "currency":
    case "percent":
      return <NumberInput {...props} />;
    case "date":
      return <DateInput {...props} />;
    case "datetime":
      return <DateTimeInput {...props} />;
    case "boolean":
      return <BooleanInput {...props} />;
    case "select":
      return <OptionPicker {...props} multi={false} />;
    case "multiSelect":
      return <OptionPicker {...props} multi />;
    case "tags":
      return <TagInput {...props} />;
    case "relation":
      return <RelationPicker {...props} />;
    case "user":
      return <UserPicker {...props} />;
    case "rating":
      return <RatingInput {...props} />;
    case "address":
      return <AddressInput {...props} />;
    default:
      return <TextInput {...props} />;
  }
}

function keyHandler(commit: () => void, cancel?: () => void, multiline = false) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel?.();
    }
  };
}

function TextInput({ field, value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, placeholder, className }: FieldInputProps) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const type = field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "phone" ? "tel" : "text";
  const emit = (v: string) => (v.trim() === "" ? undefined : v);
  return (
    <Input
      type={type}
      value={text}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        onChange(emit(e.target.value));
      }}
      onBlur={() => onCommit?.(emit(text))}
      onKeyDown={keyHandler(() => onCommit?.(emit(text)), onCancel)}
    />
  );
}

function LongTextInput({ value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, placeholder, className }: FieldInputProps) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  return (
    <Textarea
      value={text}
      rows={4}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value || undefined);
      }}
      onBlur={() => onCommit?.(text || undefined)}
      onKeyDown={keyHandler(() => onCommit?.(text || undefined), onCancel, true)}
    />
  );
}

function NumberInput({ field, value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, placeholder, className }: FieldInputProps) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const parse = (s: string): unknown => (s.trim() === "" ? undefined : parseNumber(s) ?? s);
  const suffix = field.type === "percent" ? "%" : field.type === "currency" ? field.currency ?? "" : "";
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode="decimal"
        value={text}
        autoFocus={autoFocus}
        disabled={disabled}
        invalid={invalid || (text.trim() !== "" && parseNumber(text) === null)}
        placeholder={placeholder}
        className={cn("tabular-nums", suffix && "pr-12")}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
        onBlur={() => onCommit?.(parse(text))}
        onKeyDown={keyHandler(() => onCommit?.(parse(text)), onCancel)}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-surface-400">{suffix}</span>}
    </div>
  );
}

function DateInput({ value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, className }: FieldInputProps) {
  const v = typeof value === "string" ? value.slice(0, 10) : typeof value === "number" ? toIsoDate(new Date(value)) : "";
  return (
    <Input
      type="date"
      value={v}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
      className={className}
      onChange={(e) => {
        onChange(e.target.value || undefined);
        onCommit?.(e.target.value || undefined);
      }}
      onKeyDown={keyHandler(() => onCommit?.(v || undefined), onCancel)}
    />
  );
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DateTimeInput({ value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, className }: FieldInputProps) {
  const v = typeof value === "number" ? toLocalInput(value) : "";
  return (
    <Input
      type="datetime-local"
      value={v}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
      className={className}
      onChange={(e) => {
        const ms = e.target.value ? new Date(e.target.value).getTime() : undefined;
        onChange(ms);
        onCommit?.(ms);
      }}
      onKeyDown={keyHandler(() => onCommit?.(value), onCancel)}
    />
  );
}

function BooleanInput({ value, onChange, onCommit, disabled, className }: FieldInputProps) {
  return (
    <Checkbox
      checked={!!value}
      disabled={disabled}
      className={className}
      onChange={(e) => {
        onChange(e.target.checked);
        onCommit?.(e.target.checked);
      }}
    />
  );
}

function RatingInput({ value, onChange, onCommit, disabled, className }: FieldInputProps) {
  const [hover, setHover] = useState(0);
  const current = Number(value) || 0;
  return (
    <span className={cn("inline-flex items-center", className)} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          aria-label={`${i} / 5`}
          onMouseEnter={() => setHover(i)}
          onClick={() => {
            const next = i === current ? undefined : i;
            onChange(next);
            onCommit?.(next);
          }}
          className="p-0.5"
        >
          <Star className={cn("h-4 w-4", i <= (hover || current) ? "fill-amber-400 text-amber-400" : "text-surface-300 dark:text-surface-600")} />
        </button>
      ))}
    </span>
  );
}

function AddressInput({ value, onChange, onCommit, disabled, className }: FieldInputProps) {
  const { t } = useTranslation();
  const [addr, setAddr] = useState<AddressValue>((value as AddressValue) ?? {});
  useEffect(() => setAddr((value as AddressValue) ?? {}), [value]);
  const update = (k: keyof AddressValue, v: string) => {
    const next = { ...addr, [k]: v || undefined };
    setAddr(next);
    onChange(Object.values(next).some(Boolean) ? next : undefined);
  };
  const keys: (keyof AddressValue)[] = ["street", "postalCode", "city", "region", "country"];
  return (
    <div
      className={cn("grid grid-cols-2 gap-1.5", className)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onCommit?.(Object.values(addr).some(Boolean) ? addr : undefined);
      }}
    >
      {keys.map((k) => (
        <Input key={k} disabled={disabled} className={k === "street" ? "col-span-2" : ""} placeholder={t(`fieldInput.${k}`)} value={addr[k] ?? ""} onChange={(e) => update(k, e.target.value)} />
      ))}
    </div>
  );
}

// ─── Pickers ────────────────────────────────────────────────────────────

interface PickerItem {
  id: string;
  label: string;
  sub?: string;
  color?: string;
  avatar?: { name: string; src?: string; square?: boolean };
}

function PickerPanel({
  items,
  selected,
  onToggle,
  search,
  onSearch,
  placeholder,
  emptyText,
  onClear,
}: {
  items: PickerItem[];
  selected: string[];
  onToggle(id: string): void;
  search: string;
  onSearch(q: string): void;
  placeholder: string;
  emptyText: string;
  onClear?(): void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [search]);
  return (
    <div className="w-64">
      <div className="flex items-center gap-2 border-b border-surface-100 px-2.5 dark:border-surface-800">
        <Search className="h-4 w-4 shrink-0 text-surface-400" />
        <input
          autoFocus
          value={search}
          placeholder={placeholder}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              onToggle(items[active].id);
            }
          }}
          className="h-9 w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-surface-100"
        />
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {items.length === 0 && <div className="px-3 py-2 text-sm text-surface-400">{emptyText}</div>}
        {items.map((item, i) => {
          const isSel = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => onToggle(item.id)}
              className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px]", i === active ? "bg-surface-100 dark:bg-surface-800" : "")}
            >
              {item.avatar && <Avatar name={item.avatar.name} src={item.avatar.src} size="sm" square={item.avatar.square} />}
              {item.color !== undefined ? (
                <span className={cn("inline-flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs font-medium", chipClass(item.color))}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(item.color))} />
                  {item.label}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-surface-800 dark:text-surface-100">
                  {item.label}
                  {item.sub && <span className="ml-1.5 text-xs text-surface-400">{item.sub}</span>}
                </span>
              )}
              <span className="ml-auto shrink-0">{isSel && <Check className="h-4 w-4 text-accent-600" />}</span>
            </button>
          );
        })}
      </div>
      {onClear && selected.length > 0 && (
        <button type="button" onClick={onClear} className="flex w-full items-center gap-2 border-t border-surface-100 px-2.5 py-2 text-left text-xs text-surface-500 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800">
          <X className="h-3.5 w-3.5" /> {t("fieldInput.clearValue")}
        </button>
      )}
    </div>
  );
}

function PickerTrigger({
  anchorRef,
  onClick,
  disabled,
  invalid,
  className,
  children,
  autoFocus,
}: {
  anchorRef(el: HTMLElement | null): void;
  onClick(): void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  children: React.ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <button
      ref={anchorRef}
      type="button"
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={onClick}
      className={cn(inputBase, "flex min-h-8 items-center gap-1 py-1 text-left", invalid && "border-red-400", className)}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-surface-400" />
    </button>
  );
}

function OptionPicker({ field, value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, placeholder, className, multi }: FieldInputProps & { multi: boolean }) {
  const { t } = useTranslation();
  const p = usePopover();
  const [search, setSearch] = useState("");
  const selected = multi ? ((Array.isArray(value) ? value : []) as string[]) : value ? [String(value)] : [];
  const options: SelectOption[] = field.options ?? [];
  const items = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())).map((o) => ({ id: o.id, label: o.label, color: o.color }));
  useEffect(() => {
    if (autoFocus) p.setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);
  const toggle = (id: string) => {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      const v = next.length ? next : undefined;
      onChange(v);
      onCommit?.(v);
    } else {
      const v = selected[0] === id ? undefined : id;
      onChange(v);
      onCommit?.(v);
      p.close();
    }
  };
  return (
    <>
      <PickerTrigger anchorRef={p.anchorRef} onClick={p.toggle} disabled={disabled} invalid={invalid} className={className}>
        {selected.length === 0 && <span className="text-surface-400">{placeholder ?? t("common.select")}</span>}
        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return (
            <Badge key={id} color={o?.color}>
              {o?.label ?? id}
            </Badge>
          );
        })}
      </PickerTrigger>
      <Popover
        open={p.open}
        onClose={() => {
          p.close();
          setSearch("");
          if (!multi) onCancel?.();
        }}
        anchor={p.anchor}
      >
        <PickerPanel
          items={items}
          selected={selected}
          onToggle={toggle}
          search={search}
          onSearch={setSearch}
          placeholder={t("common.search")}
          emptyText={t("fieldInput.noMatch")}
          onClear={() => {
            onChange(undefined);
            onCommit?.(undefined);
            p.close();
          }}
        />
      </Popover>
    </>
  );
}

function RelationPicker({ field, value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, placeholder, className }: FieldInputProps) {
  const { t } = useTranslation();
  const ctx = useFieldContext();
  const p = usePopover();
  const [search, setSearch] = useState("");
  const many = field.relation?.cardinality === "many";
  const target = field.relation?.object ?? "";
  const selected = (Array.isArray(value) ? value : value ? [value] : []).map(String);
  const results = useMemo(() => (p.open ? ctx.searchRecords(target, search, 30) : []), [ctx, target, search, p.open]);
  const items: PickerItem[] = results.map((r) => ({ id: r.id, label: r.label, sub: r.sub, avatar: { name: r.label, square: target === "companies" } }));
  useEffect(() => {
    if (autoFocus) p.setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);
  const toggle = (id: string) => {
    if (many) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      const v = next.length ? next : undefined;
      onChange(v);
      onCommit?.(v);
    } else {
      const v = selected[0] === id ? undefined : id;
      onChange(v);
      onCommit?.(v);
      p.close();
    }
  };
  return (
    <>
      <PickerTrigger anchorRef={p.anchorRef} onClick={p.toggle} disabled={disabled} invalid={invalid} className={className}>
        {selected.length === 0 && <span className="text-surface-400">{placeholder ?? t("common.select")}</span>}
        {selected.map((id) => (
          <span key={id} className="inline-flex max-w-full items-center gap-1 truncate rounded border border-surface-200 px-1.5 py-px text-xs dark:border-surface-700">
            <Avatar name={ctx.recordLabel(id) ?? "?"} size="xs" square={target === "companies"} />
            <span className="truncate">{ctx.recordLabel(id) ?? id}</span>
          </span>
        ))}
      </PickerTrigger>
      <Popover
        open={p.open}
        onClose={() => {
          p.close();
          setSearch("");
          if (!many) onCancel?.();
        }}
        anchor={p.anchor}
      >
        <PickerPanel
          items={items}
          selected={selected}
          onToggle={toggle}
          search={search}
          onSearch={setSearch}
          placeholder={t("fieldInput.searchRecords", { object: target })}
          emptyText={t("fieldInput.noMatch")}
          onClear={() => {
            onChange(undefined);
            onCommit?.(undefined);
            p.close();
          }}
        />
      </Popover>
    </>
  );
}

function UserPicker({ value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, placeholder, className }: FieldInputProps) {
  const { t } = useTranslation();
  const ctx = useFieldContext();
  const p = usePopover();
  const [search, setSearch] = useState("");
  const current = ctx.users.find((u) => u.id === value);
  const items: PickerItem[] = ctx.users
    .filter((u) => !u.disabled && `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()))
    .map((u) => ({ id: u.id, label: u.name, sub: u.email, avatar: { name: u.name, src: u.avatarUrl } }));
  useEffect(() => {
    if (autoFocus) p.setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);
  return (
    <>
      <PickerTrigger anchorRef={p.anchorRef} onClick={p.toggle} disabled={disabled} invalid={invalid} className={className}>
        {current ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={current.name} src={current.avatarUrl} size="sm" />
            <span className="truncate">{current.name}</span>
          </span>
        ) : (
          <span className="text-surface-400">{placeholder ?? t("fieldInput.pickUser")}</span>
        )}
      </PickerTrigger>
      <Popover
        open={p.open}
        onClose={() => {
          p.close();
          setSearch("");
          onCancel?.();
        }}
        anchor={p.anchor}
      >
        <PickerPanel
          items={items}
          selected={value ? [String(value)] : []}
          onToggle={(id) => {
            const v = id === value ? undefined : id;
            onChange(v);
            onCommit?.(v);
            p.close();
          }}
          search={search}
          onSearch={setSearch}
          placeholder={t("common.search")}
          emptyText={t("fieldInput.noMatch")}
          onClear={() => {
            onChange(undefined);
            onCommit?.(undefined);
            p.close();
          }}
        />
      </Popover>
    </>
  );
}

function TagInput({ value, onChange, onCommit, onCancel, autoFocus, disabled, invalid, className }: FieldInputProps) {
  const { t } = useTranslation();
  const tags = (Array.isArray(value) ? value : []) as string[];
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const emit = (next: string[]) => {
    const v = next.length ? next : undefined;
    onChange(v);
    onCommit?.(v);
  };
  const add = (raw: string = draft) => {
    const tag = raw.trim();
    if (tag && !tags.some((x) => x.toLowerCase() === tag.toLowerCase())) emit([...tags, tag]);
    setDraft("");
  };
  return (
    <div className={cn(inputBase, "flex min-h-8 flex-wrap items-center gap-1 py-1", invalid && "border-red-400", className)} onClick={() => input.current?.focus()}>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-0.5 rounded bg-surface-100 px-1.5 py-0.5 text-xs text-surface-700 dark:bg-surface-800 dark:text-surface-200">
          {tag}
          {!disabled && (
            <button type="button" aria-label={`Remove ${tag}`} onClick={() => emit(tags.filter((x) => x !== tag))} className="text-surface-400 hover:text-surface-700">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      <input
        ref={input}
        value={draft}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={tags.length ? "" : t("fieldInput.addTag")}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onBlur={() => draft && add()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            emit(tags.slice(0, -1));
          } else if (e.key === "Escape") {
            onCancel?.();
          }
        }}
        className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-surface-400"
      />
    </div>
  );
}
