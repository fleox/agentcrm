// Additive, idempotent schema migrations applied on boot (admin) and by
// the CLI: bring workspaces installed by an older version up to the
// current standard schema without touching user changes.
//
//   0.3.0  companies.logo / people.avatar image fields + ObjectDef.imageField
//
// Never removes or renames anything; a field the user deleted (absent) is
// re-added only once: the object remembers `migrations` it already ran.

import { localizeObjects } from "../core/schema/localize";
import { STANDARD_IMAGE_FIELDS, standardObjects } from "../core/schema/standardObjects";
import type { ObjectDef } from "../core/types";
import type { DocMutation } from "../data/types";
import { assertCan, type OpsContext } from "./context";
import { objectOf, settingsDoc } from "./store";

export const SCHEMA_MIGRATIONS = ["0.3.0-image-fields"] as const;

export interface MigrationReport {
  applied: { object: string; migration: string; added: string[] }[];
}

type MigratedObject = ObjectDef & { migrations?: string[] };

// Pure: the mutations a migration run would write (none when up to date).
export function schemaMigrationMutations(ctx: OpsContext): { mutations: DocMutation[]; report: MigrationReport } {
  const report: MigrationReport = { applied: [] };
  const mutations: DocMutation[] = [];
  const now = ctx.now();
  const locale = settingsDoc(ctx.store)?.locale;
  const standard = new Map(localizeObjects(standardObjects(now), locale).map((o) => [o.id, o]));
  const migration = SCHEMA_MIGRATIONS[0];
  for (const [objectId, fieldId] of Object.entries(STANDARD_IMAGE_FIELDS)) {
    const current = objectOf(ctx.store, objectId) as MigratedObject | undefined;
    if (!current || current.migrations?.includes(migration)) continue;
    const def = standard.get(objectId)?.fields.find((f) => f.id === fieldId);
    if (!def) continue;
    const added: string[] = [];
    const fields = [...current.fields];
    if (!fields.some((f) => f.id === fieldId)) {
      // Appended, like in the standard schema.
      fields.push({ ...def });
      added.push(fieldId);
    }
    const patch: Record<string, unknown> = { migrations: [...(current.migrations ?? []), migration], updatedAt: now };
    if (added.length) patch.fields = fields;
    const field = fields.find((f) => f.id === fieldId);
    if (!current.imageField && field?.type === "image") patch.imageField = fieldId;
    mutations.push({ op: "patch", collection: "objects", id: objectId, fields: patch });
    report.applied.push({ object: objectId, migration, added });
  }
  return { mutations, report };
}

export async function migrateSchema(ctx: OpsContext): Promise<MigrationReport> {
  assertCan(ctx, "schema.write");
  const { mutations, report } = schemaMigrationMutations(ctx);
  if (mutations.length) await ctx.store.write(mutations, { message: "Upgrade the schema (image fields)" });
  return report;
}
