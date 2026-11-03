// CRM settings (`settings/general`) and config documents (`config/<id>`:
// hosting target, integrations…). Config docs must never hold secrets —
// those stay per browser (lib/runtimeConfig.ts secrets helpers) or in the
// CLI credentials file.

import type { CrmSettings } from "../core/types";
import type { StoredDoc } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { asDoc, settingsDoc } from "./store";
import { SECRET_SETTING_KEYS } from "../lib/runtimeConfig";

export const DEFAULT_SETTINGS: CrmSettings = {
  id: "general",
  name: "AgentCRM",
  defaultCurrency: "USD",
  locale: "en-US",
  weekStartsOn: 1,
  staleDealDays: 14,
};

export function getSettings(ctx: OpsContext): CrmSettings {
  assertCan(ctx, "settings.read");
  return { ...DEFAULT_SETTINGS, ...(settingsDoc(ctx.store) ?? {}) };
}

// Keys updateSettings accepts (createdAt / updatedAt are managed here).
export const SETTINGS_KEYS = ["name", "defaultCurrency", "locale", "timezone", "weekStartsOn", "staleDealDays", "ownerUserId", "maxUploadMb"] as const;

export async function updateSettings(ctx: OpsContext, patch: Partial<Omit<CrmSettings, "id">>): Promise<CrmSettings> {
  assertCan(ctx, "settings.write");
  const unknown = Object.keys(patch).filter((k) => !(SETTINGS_KEYS as readonly string[]).includes(k) && k !== "createdAt" && k !== "updatedAt" && k !== "id");
  if (unknown.length) {
    throw new OpsError("validation", `Unknown setting${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")}. Settings: ${SETTINGS_KEYS.join(", ")}.`);
  }
  if (patch.name !== undefined && (typeof patch.name !== "string" || !patch.name.trim())) {
    throw new OpsError("validation", "The CRM name can't be empty.");
  }
  if (patch.weekStartsOn !== undefined && patch.weekStartsOn !== 0 && patch.weekStartsOn !== 1) {
    throw new OpsError("validation", "Week start must be 0 (Sunday) or 1 (Monday).");
  }
  if (patch.locale !== undefined && !validLocale(patch.locale)) {
    throw new OpsError("validation", `"${String(patch.locale)}" is not a valid locale (BCP-47, e.g. en-US, fr-FR).`);
  }
  if (patch.timezone !== undefined && patch.timezone !== null && !validTimeZone(patch.timezone)) {
    throw new OpsError("validation", `"${String(patch.timezone)}" is not a valid time zone (IANA, e.g. Europe/Paris).`);
  }
  if (patch.defaultCurrency !== undefined && !/^[A-Z]{3}$/.test(patch.defaultCurrency.toUpperCase())) {
    throw new OpsError("validation", `"${patch.defaultCurrency}" is not an ISO 4217 currency code.`);
  }
  if (patch.staleDealDays !== undefined && (!Number.isFinite(patch.staleDealDays) || patch.staleDealDays < 1)) {
    throw new OpsError("validation", "Stale deal days must be a positive number.");
  }
  if (patch.maxUploadMb !== undefined && (!Number.isFinite(patch.maxUploadMb) || patch.maxUploadMb < 1 || patch.maxUploadMb > 1024)) {
    throw new OpsError("validation", "Max upload size must be between 1 and 1024 MB.");
  }
  const current = getSettings(ctx);
  const next: CrmSettings = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    ...(patch.defaultCurrency ? { defaultCurrency: patch.defaultCurrency.toUpperCase() } : {}),
    id: "general",
    updatedAt: ctx.now(),
    createdAt: current.createdAt ?? ctx.now(),
  };
  await ctx.store.write([{ op: "set", collection: "settings", doc: asDoc(next) }], { message: "Update settings" });
  return getSettings(ctx);
}

function validLocale(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function validTimeZone(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function assertNoSecrets(value: unknown, path = ""): void {
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_SETTING_KEYS.has(k) && v !== "" && v != null) {
      throw new OpsError("validation", `Refusing to store the secret "${path}${k}" in the CRM data. Keep secrets in this browser / the CLI credentials.`);
    }
    assertNoSecrets(v, `${path}${k}.`);
  }
}

export function getConfigDoc<T extends object = Record<string, unknown>>(ctx: OpsContext, id: string): (T & { id: string }) | undefined {
  assertCan(ctx, "settings.read");
  return ctx.store.get("config", id) as unknown as (T & { id: string }) | undefined;
}

export async function setConfigDoc(ctx: OpsContext, id: string, value: Record<string, unknown> | null): Promise<void> {
  assertCan(ctx, "settings.write");
  if (value === null) {
    await ctx.store.write([{ op: "delete", collection: "config", id }], { message: `Remove config ${id}` });
    return;
  }
  assertNoSecrets(value);
  const doc: StoredDoc = { ...value, id };
  await ctx.store.write([{ op: "set", collection: "config", doc: asDoc(doc) }], { message: `Update config ${id}` });
}
