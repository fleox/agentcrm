import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown, Textarea } from "../../../components/ui";
import { cn } from "../../../shared/lib/utils";

// Markdown textarea with a Write / Preview toggle (marked + DOMPurify).
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 4,
  autoFocus,
  onSubmit,
  onCancel,
  id,
  label,
}: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  // ⌘/Ctrl+Enter.
  onSubmit?(): void;
  onCancel?(): void;
  id?: string;
  label?: string;
}) {
  const { t } = useTranslation("records");
  const [mode, setMode] = useState<"write" | "preview">("write");
  return (
    <div className="rounded-md border border-surface-200 bg-white focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20 dark:border-surface-700 dark:bg-surface-900">
      <div className="flex items-center gap-1 border-b border-surface-100 px-1.5 py-1 dark:border-surface-800">
        {(["write", "preview"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn("rounded px-1.5 py-0.5 text-xs", mode === m ? "bg-surface-100 font-medium text-surface-800 dark:bg-surface-800 dark:text-surface-100" : "text-surface-500 hover:text-surface-800 dark:hover:text-surface-200")}
          >
            {t(`markdown.${m}`)}
          </button>
        ))}
        <span className="ml-auto text-2xs text-surface-400">{t("markdown.hint")}</span>
      </div>
      {mode === "write" ? (
        <Textarea
          id={id}
          aria-label={label ?? t("markdown.body")}
          rows={rows}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
              e.preventDefault();
              onSubmit();
            } else if (e.key === "Escape" && onCancel) {
              e.stopPropagation();
              onCancel();
            }
          }}
          className="resize-y rounded-none border-0 shadow-none focus:ring-0"
        />
      ) : (
        <div className="min-h-[88px] px-2.5 py-2" data-testid="markdown-preview">
          {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-surface-400">{t("markdown.nothing")}</p>}
        </div>
      )}
    </div>
  );
}
