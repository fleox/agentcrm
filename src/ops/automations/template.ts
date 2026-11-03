// `{{placeholder}}` rendering for automation texts (task titles, notes,
// updateField string values). Placeholders:
//   {{label}}            the record's display label
//   {{<fieldId>}}        a field, formatted for display (select → label,
//                        relation → related labels, currency → "$1,200")
//   {{owner}}            owner's name   ({{owner.email}} its email)
//   {{object}}           the object's singular label
//   {{id}}, {{today}}    record id, today's date (YYYY-MM-DD)
//   {{createdAt}} …      record system props are formatted as datetimes
// Unknown placeholders render as an empty string.

import { formatFieldValue, recordLabel, toIsoDate } from "../../core/fields";
import { resolveField } from "../../core/query";
import type { CrmRecord, ObjectDef } from "../../core/types";
import type { OpsContext } from "../context";
import { queryContext } from "../records";
import { getSettings } from "../settings";
import { userOf } from "../store";

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

export function renderTemplate(ctx: OpsContext, template: string, record: CrmRecord, object: ObjectDef | undefined): string {
  if (!template.includes("{{")) return template;
  let locale: string | undefined;
  let currency: string | undefined;
  try {
    const s = getSettings({ ...ctx, user: null });
    locale = s.locale;
    currency = s.defaultCurrency;
  } catch {
    // Settings unreadable — format with defaults.
  }
  const fmt = object ? { ...queryContext(ctx, object), locale, currency } : { locale, currency };
  return template.replace(PLACEHOLDER, (_m, key: string) => {
    switch (key) {
      case "label":
      case "recordLabel":
        return recordLabel(object, record);
      case "object":
        return object?.labelSingular ?? record.object;
      case "id":
        return record.id;
      case "today":
        return toIsoDate(new Date(ctx.now()));
      case "owner":
        return record.ownerId ? (userOf(ctx.store, record.ownerId)?.name ?? "") : "";
      case "owner.email":
        return record.ownerId ? (userOf(ctx.store, record.ownerId)?.email ?? "") : "";
      case "owner.id":
        return record.ownerId ?? "";
    }
    const field = object ? resolveField(object, key) : undefined;
    const value = key in record.fields ? record.fields[key] : (record as unknown as Record<string, unknown>)[key];
    if (value === undefined || value === null) return "";
    if (!field) return typeof value === "object" ? JSON.stringify(value) : String(value);
    return formatFieldValue(field, value, fmt);
  });
}
