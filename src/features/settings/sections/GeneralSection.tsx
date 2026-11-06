// General settings: workspace name, currency, locale, week start, stale
// deal threshold, timezone; shows the data backend kind.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, HardDrive, Save } from "lucide-react";
import { Badge, Button, Card, FormField, Input, Select } from "../../../components/ui";
import { useCan, useCrm, useFiles, useOps, useSettings } from "../../../app/CrmDataContext";
import { DEFAULT_MAX_UPLOAD_MB, formatBytes } from "../../../core/files";
import { fileUsage } from "../../../ops/files";
import { useAuth } from "../../../app/AuthContext";
import { updateSettings } from "../../../ops/settings";
import { ReadOnlyNote, SectionHeader, runOp } from "../components/common";

export const LOCALES = ["en-US", "en-GB", "fr-FR", "fr-CA", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-BR", "pt-PT", "sv-SE", "pl-PL", "ja-JP"];
export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "PLN", "BRL", "INR", "CNY", "MXN"];

const FALLBACK_TIMEZONES = ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];

function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list?.length) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    // Old engines: fall through.
  }
  return FALLBACK_TIMEZONES;
}

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function preview(locale: string, currency: string, timezone: string | undefined) {
  const now = new Date();
  try {
    const tz = timezone ? { timeZone: timezone } : {};
    return {
      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...tz }).format(now),
      short: new Intl.DateTimeFormat(locale, { dateStyle: "short", ...tz }).format(now),
      time: new Intl.DateTimeFormat(locale, { timeStyle: "short", ...tz }).format(now),
      money: new Intl.NumberFormat(locale, { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD" }).format(1234567.89),
    };
  } catch {
    return { date: "—", short: "—", time: "—", money: "—" };
  }
}

export function GeneralSection() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const settings = useSettings();
  const canEdit = useCan("settings.write");
  const { backend } = useAuth();
  // Firebase with a files endpoint (runtime config `files`): no Firebase Storage.
  const filesVia = useCrm().store.files?.kind === "http" ? "http" : backend;
  const [name, setName] = useState(settings.name);
  const [currency, setCurrency] = useState(settings.defaultCurrency);
  const [locale, setLocale] = useState(settings.locale);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(settings.weekStartsOn ?? 1);
  const [staleDealDays, setStaleDealDays] = useState(String(settings.staleDealDays));
  const [timezone, setTimezone] = useState(settings.timezone ?? "");
  const [maxUploadMb, setMaxUploadMb] = useState(String(settings.maxUploadMb ?? DEFAULT_MAX_UPLOAD_MB));
  const [saving, setSaving] = useState(false);
  const files = useFiles({ includeDeleted: true });
  const usage = useMemo(() => fileUsage(ops), [ops, files]);

  useEffect(() => {
    setName(settings.name);
    setCurrency(settings.defaultCurrency);
    setLocale(settings.locale);
    setWeekStartsOn(settings.weekStartsOn ?? 1);
    setStaleDealDays(String(settings.staleDealDays));
    setTimezone(settings.timezone ?? "");
    setMaxUploadMb(String(settings.maxUploadMb ?? DEFAULT_MAX_UPLOAD_MB));
  }, [settings]);

  const tzList = useMemo(() => timezones(), []);
  const localeOptions = useMemo(() => {
    const list = LOCALES.includes(locale) ? LOCALES : [locale, ...LOCALES];
    return list.map((l) => ({ value: l, label: `${t(`general.locales.${l}`, { defaultValue: l })} (${l})` }));
  }, [locale, t]);
  const currencyOptions = useMemo(() => (CURRENCIES.includes(currency) || !/^[A-Z]{3}$/.test(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => ({ value: c, label: c })), [currency]);
  const p = preview(locale, currency, timezone || undefined);

  return (
    <div className="max-w-2xl">
      <SectionHeader title={t("general.title")} description={t("general.description")} />
      {!canEdit && <ReadOnlyNote />}
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await runOp(
            () =>
              updateSettings(ops, {
                name: name.trim() || settings.name,
                defaultCurrency: currency,
                locale,
                weekStartsOn,
                staleDealDays: Number(staleDealDays),
                timezone: timezone || undefined,
                maxUploadMb: Number(maxUploadMb) || DEFAULT_MAX_UPLOAD_MB,
              }),
            t("saved"),
          );
          setSaving(false);
        }}
      >
        <Card title={t("general.workspace")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("name")} htmlFor="crm-name" className="sm:col-span-2">
              <Input id="crm-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label={t("currency")} htmlFor="crm-currency" help={t("general.currencyHelp")}>
              <Input
                id="crm-currency"
                list="crm-currency-list"
                value={currency}
                maxLength={3}
                disabled={!canEdit}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
              <datalist id="crm-currency-list">
                {currencyOptions.map((c) => (
                  <option key={c.value} value={c.value} />
                ))}
              </datalist>
            </FormField>
            <FormField label={t("general.staleDealDays")} htmlFor="crm-stale" help={t("general.staleDealDaysHelp")}>
              <Input id="crm-stale" type="number" min={1} value={staleDealDays} disabled={!canEdit} onChange={(e) => setStaleDealDays(e.target.value)} />
            </FormField>
          </div>
        </Card>

        <Card title={t("general.regional")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("general.locale")} htmlFor="crm-locale">
              <Select id="crm-locale" value={locale} disabled={!canEdit} options={localeOptions} onChange={(e) => setLocale(e.target.value)} />
            </FormField>
            <FormField label={t("general.weekStart")} htmlFor="crm-week">
              <Select
                id="crm-week"
                value={String(weekStartsOn)}
                disabled={!canEdit}
                options={[
                  { value: "1", label: t("general.monday") },
                  { value: "0", label: t("general.sunday") },
                ]}
                onChange={(e) => setWeekStartsOn(e.target.value === "0" ? 0 : 1)}
              />
            </FormField>
            <FormField label={t("general.timezone")} htmlFor="crm-tz" help={t("general.timezoneHelp", { tz: browserTimezone() ?? "UTC" })} className="sm:col-span-2">
              <Select
                id="crm-tz"
                value={timezone}
                disabled={!canEdit}
                options={[{ value: "", label: t("general.timezoneBrowser") }, ...(timezone && !tzList.includes(timezone) ? [timezone] : []).concat(tzList).map((z) => ({ value: z, label: z }))]}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-4 rounded-md bg-surface-50 px-3 py-2 text-[13px] dark:bg-surface-800/60" data-testid="format-preview">
            <div className="mb-1 text-xs font-medium text-surface-500">{t("general.preview")}</div>
            <div className="grid gap-x-6 gap-y-1 text-surface-700 sm:grid-cols-2 dark:text-surface-200">
              <span>
                {t("general.previewDate")}: <span className="font-medium tabular-nums">{p.date}</span>
              </span>
              <span>
                {t("general.previewShort")}: <span className="font-medium tabular-nums">{p.short}</span>
              </span>
              <span>
                {t("general.previewTime")}: <span className="font-medium tabular-nums">{p.time}</span>
              </span>
              <span>
                {t("general.previewMoney")}: <span className="font-medium tabular-nums">{p.money}</span>
              </span>
            </div>
          </div>
        </Card>

        <Card title={t("backend")}>
          <div className="flex items-center gap-2 text-[13px] text-surface-700 dark:text-surface-200">
            <Database className="h-4 w-4 text-surface-400" />
            <Badge color="blue">{t(`general.backends.${backend}`, { defaultValue: backend })}</Badge>
            <span className="text-surface-500">{t(`general.backendHelp.${backend}`, { defaultValue: "" })}</span>
          </div>
        </Card>

        <Card title={t("general.files")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("general.maxUpload")} htmlFor="crm-max-upload" help={t("general.maxUploadHelp")}>
              <Input id="crm-max-upload" type="number" min={1} max={1024} value={maxUploadMb} disabled={!canEdit} onChange={(e) => setMaxUploadMb(e.target.value)} />
            </FormField>
            <div className="text-[13px]" data-testid="storage-usage">
              <div className="mb-1 text-xs font-medium text-surface-600 dark:text-surface-300">{t("general.storageUsage")}</div>
              <div className="flex items-center gap-2 text-surface-700 dark:text-surface-200">
                <HardDrive className="h-4 w-4 text-surface-400" />
                <span className="font-medium tabular-nums">{t("general.fileCount", { count: usage.count })}</span>
                <span className="text-surface-400">·</span>
                <span className="tabular-nums">{formatBytes(usage.totalBytes)}</span>
              </div>
              {usage.deleted > 0 && <p className="mt-1 text-xs text-surface-500">{t("general.deletedFiles", { count: usage.deleted, size: formatBytes(usage.deletedBytes) })}</p>}
            </div>
          </div>
          <p className="mt-3 text-xs text-surface-500">{t(`general.filesWhere.${filesVia}`, { defaultValue: "" })}</p>
          {filesVia === "firebase" && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t("general.firebaseStorageHint")}</p>}
          {backend === "git-json" && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t("general.gitFilesHint")}</p>}
        </Card>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" icon={<Save />} loading={saving}>
              {tc("common.save")}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
