// JSON body sent by the webhook action: raw field values plus display
// values, so a Zapier / Make / n8n scenario can use either.

import { formatFieldValue, recordLabel } from "../../core/fields";
import type { CrmRecord, ObjectDef } from "../../core/types";
import type { OpsContext } from "../context";
import { queryContext } from "../records";
import { userOf } from "../store";

export function summarizeForWebhook(ctx: OpsContext, record: CrmRecord, object: ObjectDef): Record<string, unknown> {
  const qctx = queryContext(ctx, object);
  const display: Record<string, string> = {};
  for (const field of object.fields) {
    const v = record.fields[field.id];
    if (v === undefined || v === null) continue;
    display[field.id] = formatFieldValue(field, v, qctx);
  }
  const owner = record.ownerId ? userOf(ctx.store, record.ownerId) : undefined;
  return {
    id: record.id,
    object: record.object,
    label: recordLabel(object, record),
    fields: record.fields,
    display,
    ...(owner ? { owner: { id: owner.id, name: owner.name, email: owner.email } } : {}),
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}
