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

export async function updateSettings(ctx: OpsContext, patch: Partial<Omit<CrmSettings, "id">>): Promise<CrmSettings> {
  assertCan(ctx, "settings.write");
  if (patch.defaultCurrency !== undefined && !/^[A-Z]{3}$/.test(patch.defaultCurrency.toUpperCase())) {
    throw new OpsError("validation", `"${patch.defaultCurrency}" is not an ISO 4217 currency code.`);
  }
  if (patch.staleDealDays !== undefined && (!Number.isFinite(patch.staleDealDays) || patch.staleDealDays < 1)) {
    throw new OpsError("validation", "Stale deal days must be a positive number.");
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

function assertNoSecrets(value: unknown, path = ""): void {
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
