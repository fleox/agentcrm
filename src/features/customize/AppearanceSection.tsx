// Settings → Appearance: preset gallery (live thumbnails) + external
// themes, accent color, neutral tone, radius, density, font, sidebar
// style, primary buttons, default mode, contrast, logo / favicon, custom
// CSS, reset — with a live preview. Writes go through
// src/ops/appearance.ts and apply live for every user of the workspace.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ImageUp, Monitor, Moon, RotateCcw, Search, Sun, Trash2 } from "lucide-react";
import { Badge, Button, Card, Select, Switch, Textarea, confirmDialog } from "../../components/ui";
import { useCan, useCollection, useConfigDoc, useOps } from "../../app/CrmDataContext";
import {
  DEFAULT_APPEARANCE,
  FONTS,
  MAX_CUSTOM_CSS,
  MAX_IMAGE_BYTES,
  NEUTRALS,
  NEUTRAL_SCALES,
  PRESETS,
  RADII,
  appearanceVars,
  applyAppearance,
  dataUrlBytes,
  externalThemesVersion,
  getExternalTheme,
  isHexColor,
  normalizeHex,
  resolveAppearance,
  subscribeExternalThemes,
  type Appearance,
  type AppearanceDoc,
  type AppearancePatch,
} from "../../appearance";
import type { ExtensionDoc } from "../../extensions/types";
import { applyPreset, resetAppearance, setAppearance, setLogo } from "../../ops/appearance";
import { toast } from "../../shared/lib/toast";
import { cn, debounce } from "../../shared/lib/utils";
import { ReadOnlyNotice, Segmented, SectionHeader, SettingRow, formatSize } from "./common";

const SWATCHES = ["#3366ff", "#0891b2", "#16a34a", "#ea580c", "#e11d48", "#7c3aed", "#db2777", "#ca8a04", "#52525b", "#0f766e"];

function useWorkspaceAppearanceValue(): { doc: AppearanceDoc | undefined; appearance: Appearance; themes: { id: string; name: string; enabled: boolean; loaded: boolean; values: Partial<Appearance> }[] } {
  const doc = useConfigDoc<AppearanceDoc>("appearance");
  const extensions = useCollection<ExtensionDoc>("extensions");
  const version = useSyncExternalStore(subscribeExternalThemes, externalThemesVersion, externalThemesVersion);
  return useMemo(() => {
    const themes = extensions
      .filter((e) => e.kind === "theme")
      .map((e) => {
        const def = getExternalTheme(e.id);
        return { id: e.id, name: def?.name ?? e.manifest.name, enabled: !!e.enabled, loaded: !!def, values: def?.appearance ?? {} };
      });
    const selected = doc?.themeId ? themes.find((x) => x.id === doc.themeId && x.enabled) : undefined;
    return { doc, appearance: resolveAppearance(doc, selected ? { appearance: selected.values } : null), themes };
    // `version` re-reads the loaded themes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, extensions, version]);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AppearanceSection() {
  const { t } = useTranslation("customize");
  const ops = useOps();
  const canEdit = useCan("appearance.write");
  const { doc, appearance, themes } = useWorkspaceAppearanceValue();
  // Local draft: instant feedback while saving (and while dragging the color).
  const [draft, setDraft] = useState<Appearance>(appearance);
  useEffect(() => setDraft(appearance), [appearance]);

  const save = async (patch: AppearancePatch) => {
    try {
      await setAppearance(ops, patch);
    } catch (err) {
      toast.error(errorText(err));
      setDraft(appearance);
    }
  };
  const update = (patch: Partial<Appearance>) => {
    setDraft((d) => ({ ...d, ...patch }));
    void save(patch);
  };

  // Accent: live on the page while dragging, saved after a pause.
  const saveAccent = useRef(debounce((hex: string) => void save({ accent: hex }), 350)).current;
  useEffect(() => () => saveAccent.cancel(), [saveAccent]);
  const onAccent = (hex: string) => {
    const next = { ...draft, accent: hex, preset: "custom" };
    setDraft(next);
    applyAppearance(next, { persist: false, theme: doc?.themeId ? getExternalTheme(doc.themeId) : null });
    saveAccent(hex);
  };

  const pickPreset = async (id: string) => {
    try {
      await applyPreset(ops, id);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const reset = async () => {
    const ok = await confirmDialog({ title: t("appearance.resetTitle"), description: t("appearance.resetBody"), confirmLabel: t("appearance.reset"), danger: true });
    if (!ok) return;
    try {
      await resetAppearance(ops);
      toast.success(t("appearance.saved"));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const disabled = !canEdit;
  return (
    <div className="space-y-5" data-testid="appearance-section">
      <SectionHeader
        title={t("appearance.title")}
        description={t("appearance.description")}
        actions={
          canEdit ? (
            <Button size="sm" variant="outline" icon={<RotateCcw />} onClick={() => void reset()}>
              {t("appearance.reset")}
            </Button>
          ) : undefined
        }
      />
      {!canEdit && <ReadOnlyNotice />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <PresetGallery current={draft} themes={themes} disabled={disabled} onPick={(id) => void pickPreset(id)} />

          <Card title={t("appearance.accent")}>
            <div className="space-y-3">
              <AccentPicker value={draft.accent} disabled={disabled} onChange={onAccent} />
              <p className="text-xs text-surface-500">{t("appearance.accentHint")}</p>
            </div>
          </Card>

          <Card padded={false}>
            <div className="px-card">
              <SettingRow label={t("appearance.neutral")}>
                <div role="radiogroup" aria-label={t("appearance.neutral")} className="flex flex-wrap gap-1.5">
                  {NEUTRALS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={draft.neutral === n}
                      disabled={disabled}
                      onClick={() => update({ neutral: n })}
                      className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium disabled:opacity-60", draft.neutral === n ? "border-accent-500 ring-2 ring-accent-500/20" : "border-surface-200 hover:border-surface-300 dark:border-surface-700")}
                    >
                      <span className="flex">
                        {([200, 500, 800] as const).map((s) => (
                          <span key={s} className="-ml-0.5 h-3 w-3 rounded-full border border-white first:ml-0 dark:border-surface-900" style={{ background: NEUTRAL_SCALES[n][s] }} />
                        ))}
                      </span>
                      {t(`appearance.neutrals.${n}`)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label={t("appearance.radius")}>
                <Segmented
                  label={t("appearance.radius")}
                  value={draft.radius}
                  disabled={disabled}
                  onChange={(v) => update({ radius: v })}
                  options={RADII.map((r) => ({ value: r, label: t(`appearance.radii.${r}`), icon: <RadiusIcon radius={r} /> }))}
                />
              </SettingRow>
              <SettingRow label={t("appearance.density")}>
                <Segmented label={t("appearance.density")} value={draft.density} disabled={disabled} onChange={(v) => update({ density: v })} options={(["comfortable", "compact"] as const).map((d) => ({ value: d, label: t(`appearance.densities.${d}`) }))} />
              </SettingRow>
              <SettingRow label={t("appearance.font")} hint={t("appearance.fontHint")}>
                <Select className="w-56" aria-label={t("appearance.font")} value={draft.font} disabled={disabled} options={FONTS.map((f) => ({ value: f.id, label: f.label }))} onChange={(e) => update({ font: e.target.value })} />
              </SettingRow>
              <SettingRow label={t("appearance.sidebar")}>
                <Segmented label={t("appearance.sidebar")} value={draft.sidebar} disabled={disabled} onChange={(v) => update({ sidebar: v })} options={(["default", "dark", "accent"] as const).map((v) => ({ value: v, label: t(`appearance.sidebars.${v}`) }))} />
              </SettingRow>
              <SettingRow label={t("appearance.buttons")}>
                <Segmented label={t("appearance.buttons")} value={draft.buttons} disabled={disabled} onChange={(v) => update({ buttons: v })} options={(["neutral", "accent"] as const).map((v) => ({ value: v, label: t(`appearance.buttonStyles.${v}`) }))} />
              </SettingRow>
              <SettingRow label={t("appearance.mode")} hint={t("appearance.modeHint")}>
                <Segmented
                  label={t("appearance.mode")}
                  value={draft.defaultMode}
                  disabled={disabled}
                  onChange={(v) => update({ defaultMode: v })}
                  options={[
                    { value: "system", label: t("appearance.modes.system"), icon: <Monitor /> },
                    { value: "light", label: t("appearance.modes.light"), icon: <Sun /> },
                    { value: "dark", label: t("appearance.modes.dark"), icon: <Moon /> },
                  ]}
                />
              </SettingRow>
              <SettingRow label={t("appearance.contrast")} hint={t("appearance.contrastHint")}>
                <Switch checked={draft.contrast === "high"} disabled={disabled} onChange={(v) => update({ contrast: v ? "high" : "normal" })} label={<span className="sr-only">{t("appearance.contrast")}</span>} />
              </SettingRow>
            </div>
          </Card>

          <Card title={t("appearance.branding")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField label={t("appearance.logo")} value={draft.logo} disabled={disabled} kind="logo" />
              <ImageField label={t("appearance.favicon")} value={draft.favicon} disabled={disabled} kind="favicon" />
            </div>
          </Card>

          <CustomCssEditor value={doc?.customCss ?? ""} disabled={disabled} />
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <Card title={t("appearance.preview")}>
            <Preview appearance={draft} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function RadiusIcon({ radius }: { radius: Appearance["radius"] }) {
  const r = { none: 0, sm: 2, md: 4, lg: 6, xl: 9 }[radius];
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d={`M2 12 V${2 + r} ${r ? `Q2 2 ${2 + r} 2` : ""} H12`} stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function AccentPicker({ value, onChange, disabled }: { value: string; onChange(hex: string): void; disabled?: boolean }) {
  const { t } = useTranslation("customize");
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative inline-flex h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-surface-200 shadow-sm dark:border-surface-700" style={{ background: value }}>
        <input type="color" aria-label={t("appearance.accent")} className="absolute inset-0 cursor-pointer opacity-0" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-surface-500">
        {t("appearance.hex")}
        <input
          aria-label={t("appearance.hex")}
          className="h-8 w-24 rounded-md border border-surface-200 bg-white px-2 font-mono text-[13px] text-surface-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
          value={text}
          disabled={disabled}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (isHexColor(e.target.value) && e.target.value.replace("#", "").length === 6) onChange(normalizeHex(e.target.value));
          }}
          onBlur={() => setText(value)}
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-label={s}
            onClick={() => onChange(s)}
            className={cn("flex h-6 w-6 items-center justify-center rounded-full border border-black/10 text-white disabled:opacity-60", value.toLowerCase() === s && "ring-2 ring-offset-1 ring-surface-400 dark:ring-offset-surface-900")}
            style={{ background: s }}
          >
            {value.toLowerCase() === s && <Check className="h-3 w-3" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function PresetGallery({ current, themes, onPick, disabled }: { current: Appearance; themes: { id: string; name: string; enabled: boolean; loaded: boolean; values: Partial<Appearance> }[]; onPick(id: string): void; disabled?: boolean }) {
  const { t } = useTranslation("customize");
  const card = (id: string, name: string, values: Appearance, extra?: ReactNode, off?: boolean) => {
    const active = current.preset === id;
    return (
      <button
        key={id}
        type="button"
        disabled={disabled || off}
        onClick={() => onPick(id)}
        aria-pressed={active}
        data-preset={id}
        className={cn("group rounded-lg border p-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:cursor-not-allowed", active ? "border-accent-500 ring-2 ring-accent-500/20" : "border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600", off && "opacity-50")}
      >
        <Thumbnail appearance={values} />
        <div className="flex items-center gap-1 px-0.5 pt-1.5 text-xs font-medium text-surface-800 dark:text-surface-100">
          <span className="truncate">{name}</span>
          {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-accent-600" />}
          {extra}
        </div>
      </button>
    );
  };
  return (
    <Card title={t("appearance.presets")} actions={current.preset === "custom" ? <Badge color="blue">{t("appearance.custom")}</Badge> : undefined}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">{PRESETS.map((p) => card(p.id, p.name, { ...DEFAULT_APPEARANCE, ...p.values, preset: p.id }))}</div>
      {themes.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-2xs font-medium uppercase tracking-wide text-surface-400">{t("appearance.themes")}</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {themes.map((th) => card(th.id, th.name, { ...DEFAULT_APPEARANCE, ...th.values, preset: th.id }, !th.loaded ? <span className="ml-auto text-2xs text-surface-400">{t("appearance.themeNotLoaded")}</span> : undefined, !th.enabled))}
          </div>
        </>
      )}
    </Card>
  );
}

function scoped(a: Appearance): CSSProperties {
  return { ...(appearanceVars(a) as CSSProperties), fontFamily: "var(--font-sans)" };
}

// A miniature of the app with the appearance's variables.
function Thumbnail({ appearance }: { appearance: Appearance }) {
  const sidebar = appearance.sidebar;
  return (
    <div style={scoped(appearance)} className="flex h-[68px] overflow-hidden rounded-md border border-surface-200 bg-white" aria-hidden="true">
      <div className={cn("flex w-[30%] flex-col gap-1 p-1.5", sidebar === "default" ? "bg-surface-50" : sidebar === "dark" ? "bg-surface-900" : "bg-accent-700")}>
        <div className={cn("h-1.5 w-3/4 rounded-sm", sidebar === "default" ? "bg-surface-300" : "bg-white/40")} />
        <div className={cn("h-1.5 w-full rounded-sm", sidebar === "default" ? "bg-surface-200" : "bg-white/20")} />
        <div className={cn("h-1.5 w-2/3 rounded-sm", sidebar === "default" ? "bg-surface-200" : "bg-white/20")} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
        <div className="flex items-center gap-1">
          <div className="h-2 flex-1 rounded-sm bg-surface-100" />
          <div className="h-2.5 w-6 rounded bg-primary" />
        </div>
        <div className="h-1.5 w-full rounded-sm bg-surface-100" />
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-1/2 rounded-sm bg-surface-200" />
          <div className="h-2 w-5 rounded-full bg-accent-100" />
        </div>
        <div className="h-1.5 w-3/4 rounded-sm bg-accent-500" />
      </div>
    </div>
  );
}

function Preview({ appearance }: { appearance: Appearance }) {
  const { t } = useTranslation("customize");
  const s = (k: string) => t(`appearance.previewSample.${k}`);
  const sidebar = appearance.sidebar;
  return (
    <div style={scoped(appearance)} className="overflow-hidden rounded-lg border border-surface-200 bg-white text-surface-900 dark:border-surface-800 dark:bg-surface-950 dark:text-surface-100" data-testid="appearance-preview">
      <div className="flex">
        <div className={cn("w-24 shrink-0 space-y-1 border-r p-2", sidebar === "default" ? "border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900" : "dark border-surface-800 bg-surface-900", sidebar === "accent" && "acrm-sidebar-accent")}>
          <div className="mb-2 flex items-center gap-1.5">
            {appearance.logo ? <img src={appearance.logo} alt="" className="h-4 w-4 rounded object-contain" /> : <span className="h-4 w-4 rounded bg-surface-900 dark:bg-white" />}
            <span className="h-2 w-10 rounded-sm bg-surface-300 dark:bg-surface-600" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cn("h-5 rounded-md px-1.5 py-1.5", i === 1 ? "bg-surface-200/70 dark:bg-surface-800" : "")}>
              <div className={cn("h-2 rounded-sm", i === 1 ? "w-10 bg-surface-500 dark:bg-surface-300" : "w-12 bg-surface-300 dark:bg-surface-600")} />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-surface-200 px-3 py-page dark:border-surface-800">
            <span className="truncate text-[13px] font-semibold">{s("title")}</span>
            <span className="ml-auto flex h-6 items-center gap-1 rounded-md border border-surface-200 px-1.5 text-2xs text-surface-400 dark:border-surface-700">
              <Search className="h-3 w-3" />
              {s("search")}
            </span>
          </div>
          <div className="space-y-2 p-3">
            <div className="flex gap-1.5">
              <Button size="xs" variant="primary">
                {s("primary")}
              </Button>
              <Button size="xs" variant="outline">
                {s("secondary")}
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border border-surface-200 dark:border-surface-800">
              {["row1", "row2", "row3"].map((r, i) => (
                <div key={r} className={cn("flex h-row items-center gap-2 border-b border-surface-100 px-2 text-xs last:border-b-0 dark:border-surface-800", i === 0 && "bg-accent-50/60 dark:bg-accent-500/10")}>
                  <span className="flex-1 truncate">{s(r)}</span>
                  {i === 0 && <Badge color="blue">{s("badge")}</Badge>}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-accent-600 dark:text-accent-400">{s("link")}</span>
              <span className="h-4 w-7 rounded-full bg-accent-600 p-0.5">
                <span className="block h-3 w-3 translate-x-3 rounded-full bg-white" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageField({ label, value, kind, disabled }: { label: string; value: string | undefined; kind: "logo" | "favicon"; disabled?: boolean }) {
  const { t } = useTranslation("customize");
  const ops = useOps();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("appearance.imageTooLarge"));
      return;
    }
    setBusy(true);
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      await setLogo(ops, url, { kind });
      toast.success(t("appearance.saved"));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await setLogo(ops, null, { kind });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3" data-image={kind}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-surface-300 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
        {value ? <img src={value} alt="" className="max-h-full max-w-full object-contain" /> : <ImageUp className="h-4 w-4 text-surface-400" />}
      </span>
      <div className="min-w-0 space-y-1">
        <div className="text-[13px] font-medium text-surface-900 dark:text-white">{label}</div>
        <div className="text-2xs text-surface-500">{value ? formatSize(dataUrlBytes(value)) : t("appearance.imageHint")}</div>
        {!disabled && (
          <div className="flex gap-1">
            <Button size="xs" variant="outline" icon={<ImageUp />} loading={busy} onClick={() => input.current?.click()}>
              {t("appearance.upload")}
            </Button>
            {value && (
              <Button size="xs" variant="ghost" icon={<Trash2 />} disabled={busy} onClick={() => void remove()}>
                {t("appearance.remove")}
              </Button>
            )}
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,.ico" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

function CustomCssEditor({ value, disabled }: { value: string; disabled?: boolean }) {
  const { t } = useTranslation("customize");
  const ops = useOps();
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(value), [value]);
  const bytes = new TextEncoder().encode(text).length;
  const over = bytes > MAX_CUSTOM_CSS;
  const save = async () => {
    setBusy(true);
    try {
      await setAppearance(ops, { customCss: text.trim() ? text : null });
      toast.success(t("appearance.saved"));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t("appearance.customCss")} actions={<span className={cn("text-2xs tabular-nums", over ? "font-medium text-red-600" : "text-surface-400")}>{`${formatSize(bytes)} / ${MAX_CUSTOM_CSS / 1024} KB`}</span>}>
      <form
        data-form-type="other"
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-xs text-surface-500">{t("appearance.customCssHint")}</p>
        <Textarea
          aria-label={t("appearance.customCss")}
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
          value={text}
          disabled={disabled}
          invalid={over}
          placeholder={":root {\n  --acc-500: 51 102 255;\n}"}
          onChange={(e) => setText(e.target.value)}
        />
        {!disabled && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" icon={<Check />} loading={busy} disabled={over || text === value}>
              {t("appearance.save")}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
