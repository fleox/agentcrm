// Building blocks shared by the setup wizard, the access screens and the
// Settings sections: choice cards, stepper, connector fields, passphrase
// fields with a strength meter, folder picker, status notes.

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, CheckCircle2, Copy, Eye, EyeOff, FolderOpen, Info, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { Badge, Button, Checkbox, FormField, Input, Select, Switch } from "../../../components/ui";
import { isLocalFolderSupported, pickLocalFolder, saveFolderHandle, ensureFolderPermission, loadFolderHandle } from "../../../shared/git";
import { generatePassphrase } from "../../../shared/crypto";
import { cn } from "../../../shared/lib/utils";
import { toast } from "../../../shared/lib/toast";
import { passphraseStrength } from "../services/passphrase";
import type { FieldDef } from "../services/locations";

// ─── Choice cards ────────────────────────────────────────────────────────

export interface Choice<T extends string> {
  id: T;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export function ChoiceCards<T extends string>({ choices, value, onChange, columns = 2 }: { choices: Choice<T>[]; value: T; onChange(id: T): void; columns?: 1 | 2 | 3 }) {
  return (
    <div className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3")} role="radiogroup">
      {choices.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={c.disabled}
            onClick={() => onChange(c.id)}
            className={cn(
              "group relative flex items-start gap-3 rounded-lg border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "border-accent-500 bg-accent-50/60 ring-1 ring-accent-500 dark:bg-accent-500/10"
                : "border-surface-200 bg-white hover:border-surface-300 hover:shadow-sm dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700",
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md [&>svg]:h-4 [&>svg]:w-4",
                active ? "bg-accent-600 text-white" : "bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300",
              )}
            >
              {c.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-surface-900 dark:text-white">
                {c.title}
                {c.badge}
              </span>
              {c.description && <span className="mt-0.5 block text-xs leading-relaxed text-surface-500">{c.description}</span>}
            </span>
            <span className={cn("absolute right-2.5 top-2.5 text-accent-600 [&>svg]:h-4 [&>svg]:w-4", !active && "invisible")}>
              <Check />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function RecommendedBadge() {
  const { t } = useTranslation("setup");
  return (
    <Badge color="green" className="text-[10px]">
      {t("common.recommended")}
    </Badge>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────

export function Stepper({ steps, current }: { steps: { id: string; label: string }[]; current: string }) {
  const index = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 text-xs" aria-label="progress">
      {steps.map((s, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1">
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold [&>svg]:h-3 [&>svg]:w-3",
                done && "bg-accent-600 text-white",
                active && "bg-surface-900 text-white dark:bg-white dark:text-surface-900",
                !done && !active && "bg-surface-200 text-surface-500 dark:bg-surface-800",
              )}
            >
              <span className={cn(!done && "hidden")}>
                <Check />
              </span>
              <span className={cn(done && "hidden")}>{i + 1}</span>
            </span>
            <span className={cn("font-medium", active ? "text-surface-900 dark:text-white" : "text-surface-500")}>{s.label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-4 bg-surface-300 dark:bg-surface-700 sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Notes ───────────────────────────────────────────────────────────────

export function Note({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
    danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="break-words">{children}</div>}
      </div>
    </div>
  );
}

export type TestState = { status: "idle" } | { status: "running" } | { status: "ok"; detail: ReactNode } | { status: "error"; detail: ReactNode };

export function TestStatus({ state }: { state: TestState }) {
  if (state.status === "idle" || state.status === "running") return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", state.status === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      <span className="mt-0.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{state.status === "ok" ? <CheckCircle2 /> : <XCircle />}</span>
      <span className="min-w-0 break-words">{state.detail}</span>
    </p>
  );
}

// ─── Connector fields ────────────────────────────────────────────────────

export function SecretInput({ id, value, onChange, placeholder, invalid }: { id: string; value: string; onChange(v: string): void; placeholder?: string; invalid?: boolean }) {
  const { t } = useTranslation("setup");
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={value} placeholder={placeholder} invalid={invalid} onChange={(e) => onChange(e.target.value)} className="pr-9" />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t("common.hide") : t("common.show")}
        className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-surface-400 hover:text-surface-700 [&>svg]:h-3.5 [&>svg]:w-3.5"
      >
        <span className={cn("inline-flex", shown && "hidden")}>
          <Eye />
        </span>
        <span className={cn("inline-flex", !shown && "hidden")}>
          <EyeOff />
        </span>
      </button>
    </div>
  );
}

export function ConnectorFields({
  fields,
  value,
  onChange,
  idPrefix,
  placeholders = {},
  missing = [],
}: {
  fields: FieldDef[];
  value: Record<string, unknown>;
  onChange(next: Record<string, unknown>): void;
  idPrefix: string;
  placeholders?: Record<string, string>;
  missing?: string[];
}) {
  const { t } = useTranslation("setup");
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const visible = fields.filter((f) => !f.show || f.show(value));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visible.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const label = (
          <>
            {t(`fields.${f.key}`)}
            {f.required && <span className="ml-0.5 text-red-500">*</span>}
          </>
        );
        const help = f.help ? t(`fields.${f.key}Help`) : undefined;
        const str = typeof value[f.key] === "string" ? (value[f.key] as string) : "";
        if (f.type === "checkbox") {
          return (
            <div key={f.key} className="sm:col-span-2">
              <Checkbox id={id} label={t(`fields.${f.key}`)} checked={value[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
              {help && <p className="ml-6 mt-0.5 text-xs text-surface-500">{help}</p>}
            </div>
          );
        }
        const invalid = missing.includes(f.key);
        return (
          <FormField key={f.key} label={label} htmlFor={id} help={help} className={cn((f.key === "token" || f.key === "secretAccessKey" || f.key === "endpoint" || f.key === "siteUrl") && "sm:col-span-2")}>
            {f.type === "password" ? (
              <SecretInput id={id} value={str} onChange={(v) => set(f.key, v)} invalid={invalid} placeholder={placeholders[f.key] ?? f.placeholder} />
            ) : f.type === "select" ? (
              <Select id={id} value={str} onChange={(e) => set(f.key, e.target.value)} options={(f.options ?? []).map((o) => ({ value: o, label: t(`fields.options.${o}`, { defaultValue: o }) }))} />
            ) : (
              <Input id={id} autoComplete="off" spellCheck={false} value={str} invalid={invalid} placeholder={placeholders[f.key] ?? f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </FormField>
        );
      })}
    </div>
  );
}

// ─── Local folder ────────────────────────────────────────────────────────

export function FolderPicker({ handleKey, onPicked, picked }: { handleKey: string; onPicked(name: string): void; picked: string | null }) {
  const { t } = useTranslation("setup");
  const [busy, setBusy] = useState(false);
  if (!isLocalFolderSupported()) return <Note tone="warning">{t("location.folderUnsupported")}</Note>;
  const pick = async () => {
    setBusy(true);
    try {
      const handle = await pickLocalFolder();
      await saveFolderHandle(handleKey, handle);
      onPicked(handle.name);
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button icon={<FolderOpen />} onClick={() => void pick()} loading={busy}>
        {picked ? t("location.changeFolder") : t("location.pickFolder")}
      </Button>
      {picked && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> {picked}
        </span>
      )}
    </div>
  );
}

// Re-grants a stored folder handle (browsers drop the grant on reload).
export async function regrantFolder(handleKey: string): Promise<boolean> {
  const handle = await loadFolderHandle(handleKey);
  if (!handle) return false;
  return ensureFolderPermission(handle, true);
}

// ─── Passphrase ──────────────────────────────────────────────────────────

const STRENGTH_COLORS = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];

export function StrengthMeter({ value }: { value: string }) {
  const { t } = useTranslation("setup");
  const { score } = passphraseStrength(value);
  return (
    <div className="space-y-1">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", value && i < Math.max(score, 1) ? STRENGTH_COLORS[score] : "bg-surface-200 dark:bg-surface-800")} />
        ))}
      </div>
      <p className="text-[11px] text-surface-500">{value ? t(`passphrase.strength.${score}`) : t("passphrase.strengthHint")}</p>
    </div>
  );
}

export function PassphraseFields({
  passphrase,
  confirm,
  onChange,
  idPrefix,
  withConfirm = true,
}: {
  passphrase: string;
  confirm: string;
  onChange(next: { passphrase: string; confirm: string }): void;
  idPrefix: string;
  withConfirm?: boolean;
}) {
  const { t } = useTranslation("setup");
  const mismatch = withConfirm && !!confirm && confirm !== passphrase;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("passphrase.label")} htmlFor={`${idPrefix}-pass`}>
          <SecretInput id={`${idPrefix}-pass`} value={passphrase} onChange={(v) => onChange({ passphrase: v, confirm })} />
        </FormField>
        {withConfirm && (
          <FormField label={t("passphrase.confirm")} htmlFor={`${idPrefix}-confirm`} error={mismatch ? t("passphrase.mismatch") : undefined}>
            <SecretInput id={`${idPrefix}-confirm`} value={confirm} onChange={(v) => onChange({ passphrase, confirm: v })} invalid={mismatch} />
          </FormField>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <StrengthMeter value={passphrase} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Sparkles />}
          onClick={() => {
            const p = generatePassphrase();
            onChange({ passphrase: p, confirm: p });
            void navigator.clipboard?.writeText(p).then(
              () => toast.success(t("passphrase.generatedCopied")),
              () => undefined,
            );
          }}
        >
          {t("passphrase.generate")}
        </Button>
      </div>
    </div>
  );
}

export function EncryptionToggle({ enabled, onChange, disabled }: { enabled: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  const { t } = useTranslation("setup");
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-surface-200 p-3 dark:border-surface-800">
      <div>
        <p className="text-sm font-medium">{t("passphrase.encryptTitle")}</p>
        <p className="text-xs text-surface-500">{t("passphrase.encryptHint")}</p>
      </div>
      <Switch checked={enabled} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ─── Misc ────────────────────────────────────────────────────────────────

export function CopyBlock({ text, label, maxHeight = "16rem" }: { text: string; label?: string; maxHeight?: string }) {
  const { t } = useTranslation("setup");
  return (
    <div className="relative">
      <pre className="overflow-auto rounded-lg border border-surface-200 bg-surface-50 p-3 pr-10 font-mono text-[11px] leading-relaxed text-surface-800 dark:border-surface-800 dark:bg-surface-950 dark:text-surface-200" style={{ maxHeight }}>
        {text}
      </pre>
      <Button
        size="xs"
        variant="outline"
        icon={<Copy />}
        className="absolute right-2 top-2"
        aria-label={label ?? t("common.copy")}
        onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success(t("common.copied")), () => toast.error(t("common.copyFailed")))}
      >
        {t("common.copy")}
      </Button>
    </div>
  );
}

export function TestButton({ onClick, running, label }: { onClick(): void; running: boolean; label?: string }) {
  const { t } = useTranslation("setup");
  return (
    <Button icon={<RefreshCw />} loading={running} onClick={onClick}>
      {label ?? t("common.testConnection")}
    </Button>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-surface-900 dark:text-white">{children}</h3>
      {hint && <p className="mt-0.5 text-xs text-surface-500">{hint}</p>}
    </div>
  );
}
