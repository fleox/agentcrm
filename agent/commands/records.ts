import { FILTER_OPS, type CrmRecord } from "../../src/core/types";
import type { OpsContext } from "../../src/ops/context";
import type { DuplicateGroup } from "../../src/ops/dedupe";
import { withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, fieldsInput, listOpt, multiOpt, numOpt, parseFilters, parseSorts, positional, SITE_OPTION, strOpt, table, usage, YES_OPTION } from "./util";

// A record as the CLI prints it: stored values (round-trippable into
// `records update`) plus its label; --columns keeps only some fields.
export async function recordOut(ctx: OpsContext, r: CrmRecord, columns?: string[]): Promise<Record<string, unknown>> {
  const { recordLabel } = await import("../../src/core/fields");
  const { objectOf } = await import("../../src/ops/store");
  const fields = columns ? Object.fromEntries(columns.filter((c) => c in r.fields).map((c) => [c, r.fields[c]])) : r.fields;
  const updates = r.fieldUpdates
    ? Object.fromEntries(Object.entries(r.fieldUpdates).filter(([k]) => !columns || columns.includes(k)).map(([k, u]) => [k, { by: u.by, at: new Date(u.at).toISOString() }]))
    : undefined;
  return {
    id: r.id,
    object: r.object,
    label: recordLabel(objectOf(ctx.store, r.object), r),
    fields,
    ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    ...(r.createdBy ? { createdBy: r.createdBy } : {}),
    ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
    ...(updates && Object.keys(updates).length ? { fieldUpdates: updates } : {}),
    ...(r.deletedAt ? { deletedAt: new Date(r.deletedAt).toISOString() } : {}),
  };
}

const U = {
  list: "records list --object <id> [--filter field:op:value]… [--sort field[:desc]] [--search <q>] [--view <id>] [--owner <userId>] [--limit n] [--offset n] [--columns a,b] [--deleted]",
  get: "records get <id>",
  create: "records create --object <id> [--fields <json|@file>] [--set key=value]… [--owner <userId>]",
  update: "records update <id> [--fields <json|@file>] [--set key=value]… [--owner <userId>]",
  delete: "records delete <id>… [--hard] [--yes]",
  restore: "records restore <id>",
  search: "records search <query> [--object <id>]… [--limit n]",
  duplicates: "records duplicates --object <id> [--by email,domain,name,phone]",
  merge: "records merge <primaryId> <duplicateId>… [--yes]",
  image: "records image <recordId> <path> | --remove [--field <imageFieldId>]",
  sync: "records sync --object <id> --key <fieldId> --rows <json|@file|-> [--archive-field <fieldId>] [--ref-key <fieldId>] [--yes]",
};

export const recordsCommand: Command = {
  name: "records",
  usage: "records <list|get|create|update|delete|restore|search|duplicates|merge|image|sync> …",
  summary: "Records of any object (companies, people, deals, custom objects): list with filters / sorts / pagination, get with relations and timeline counts, create, update (only the given fields), soft delete / restore, full-text search, find and merge duplicates.",
  subcommands: [
    { name: "list", usage: U.list, summary: `List records. Filter ops: ${FILTER_OPS.join(", ")}. Values: in/notIn comma-separated; dates YYYY-MM-DD, today, +30d.` },
    { name: "get", usage: U.get, summary: "One record with its relations (both directions) and activity count." },
    { name: "create", usage: U.create, summary: "Create a record (field ids from `objects get`; select fields take an option id or label).", writes: true },
    { name: "update", usage: U.update, summary: "Update some fields (null clears a field).", writes: true },
    { name: "delete", usage: U.delete, summary: "Soft delete (restorable until `compact`); --hard removes at once. Plan unless --yes.", writes: true, destructive: true },
    { name: "restore", usage: U.restore, summary: "Restore a soft-deleted record.", writes: true },
    { name: "search", usage: U.search, summary: "Full-text search (names, emails, domains, phones)." },
    { name: "duplicates", usage: U.duplicates, summary: "Groups of likely duplicates (same email / domain / name / phone)." },
    { name: "merge", usage: U.merge, summary: "Merge duplicates into the primary (empty fields filled, relations and activities moved). Plan unless --yes.", writes: true, destructive: true },
    { name: "image", usage: U.image, summary: "Set the record's avatar / logo from a local image (the object's image field), or --remove it.", writes: true },
    {
      name: "sync",
      usage: U.sync,
      summary:
        'Mirror an external source into one object: rows [{ key, fields }] matched on the --key field, created / updated only where a value differs; relation values reference other mirrored records by their key ({ "$key": "12" } or { "$key": ["12","13"] }); records whose key is missing get --archive-field = true (never deleted). No automation fires. Plan unless --yes.',
      writes: true,
    },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "object", type: "string", description: "Object id (companies, people, deals, …).", multiple: true },
    { name: "filter", type: "string", description: "field:op:value (repeatable).", multiple: true },
    { name: "sort", type: "string", description: "field[:asc|desc] (repeatable; --sort=-field also means desc).", multiple: true },
    { name: "search", type: "string", description: "list: full-text filter." },
    { name: "view", type: "string", description: "list: apply a saved view's filters and sorts." },
    { name: "owner", type: "string", description: "list: owned by this user id; create / update: set the owner (\"\" clears)." },
    { name: "limit", type: "string", description: "Page size (default 50, max 500)." },
    { name: "offset", type: "string", description: "Page offset." },
    { name: "columns", type: "string", description: "list: only these field ids in the output (comma-separated)." },
    { name: "deleted", type: "boolean", description: "list: only soft-deleted records." },
    { name: "fields", type: "string", description: "create / update: field values as a JSON object or @file.json." },
    { name: "set", type: "string", description: "create / update: key=value (repeatable; numbers / true / null / JSON parsed).", multiple: true },
    { name: "hard", type: "boolean", description: "delete: remove immediately (no restore)." },
    { name: "by", type: "string", description: "duplicates: email,domain,name,phone." },
    { name: "remove", type: "boolean", description: "image: remove the record's image." },
    { name: "field", type: "string", description: "image: image field id (default: the object's image field)." },
    { name: "key", type: "string", description: "sync: field holding the source id (match key)." },
    { name: "rows", type: "string", description: "sync: rows as a JSON array [{ key, fields }], @file.json or - (stdin)." },
    { name: "archive-field", type: "string", description: "sync: boolean field set to true on records whose key is missing from the rows." },
    { name: "ref-key", type: "string", description: "sync: key field of related objects for { \"$key\": … } (default: --key)." },
  ],
  async run({ io, options, positionals }) {
    const [action, ...args] = positionals;
    const object = () => {
      const o = listOpt(options, "object")?.[0];
      if (!o) usage("--object is required.", "Objects: `agentcrm objects list`.");
      return o;
    };
    switch (action) {
      case "list": {
        const objectId = object();
        const columns = listOpt(options, "columns");
        const filters = parseFilters(multiOpt(options, "filter"), FILTER_OPS);
        const sorts = parseSorts(multiOpt(options, "sort"));
        return withSession(io, options, {}, async ({ ctx }) => {
          const { listRecords } = await import("../../src/ops/records");
          const page = listRecords(ctx, objectId, {
            filters,
            sorts,
            search: strOpt(options, "search"),
            viewId: strOpt(options, "view"),
            ownerId: strOpt(options, "owner"),
            offset: numOpt(options, "offset") ?? 0,
            limit: Math.min(500, numOpt(options, "limit") ?? 50),
            onlyDeleted: boolOpt(options, "deleted"),
          });
          return { object: objectId, total: page.total, offset: page.offset, hasMore: page.hasMore, records: await Promise.all(page.items.map((r) => recordOut(ctx, r, columns))) };
        }, (r) => `${r.total} record(s)${r.hasMore ? ` (showing ${r.records.length} from ${r.offset})` : ""}\n${table(r.records, ["id", "label", "updatedAt"])}`);
      }
      case "get": {
        const id = positional(args, 0, "record id", U.get);
        return withSession(io, options, {}, async ({ ctx }) => {
          const { getRecordDetails } = await import("../../src/ops/records");
          const d = getRecordDetails(ctx, id);
          return { ...(await recordOut(ctx, d.record)), relations: d.relations, related: d.inverse.filter((i) => i.records.length), activityCount: d.activityCount };
        });
      }
      case "create": {
        const objectId = object();
        const fields = fieldsInput(options);
        if (!Object.keys(fields).length) usage("records create needs --fields or --set.", `Usage: agentcrm ${U.create}`);
        const owner = strOpt(options, "owner");
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const { createRecord } = await import("../../src/ops/records");
          return recordOut(ctx, await createRecord(ctx, objectId, fields, owner ? { ownerId: owner } : {}));
        }, (r) => `Created ${r.object} ${r.id} (${String(r.label)})`);
      }
      case "update": {
        const id = positional(args, 0, "record id", U.update);
        const fields = fieldsInput(options);
        const owner = strOpt(options, "owner");
        if (!Object.keys(fields).length && owner === undefined) usage("records update needs --fields, --set or --owner.");
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const { updateRecord } = await import("../../src/ops/records");
          return recordOut(ctx, await updateRecord(ctx, id, fields, owner !== undefined ? { ownerId: owner || null } : {}));
        }, (r) => `Updated ${r.id} (${String(r.label)})`);
      }
      case "delete": {
        if (!args.length) usage("records delete needs at least one id.", `Usage: agentcrm ${U.delete}`);
        const hard = boolOpt(options, "hard");
        return withSession(io, options, { lock: options.yes === true }, async ({ ctx }) => {
          const { getRecord, deleteRecord, bulkDelete } = await import("../../src/ops/records");
          const { recordLabel } = await import("../../src/core/fields");
          const { objectOf } = await import("../../src/ops/store");
          const targets = args.map((id) => getRecord(ctx, id, { includeDeleted: true }));
          const plan = { delete: targets.map((r) => ({ id: r.id, object: r.object, label: recordLabel(objectOf(ctx.store, r.object), r) })), hard, restorable: !hard };
          if (options.yes !== true) return { needsConfirmation: true as const, plan };
          if (args.length === 1) return { deleted: [await deleteRecord(ctx, args[0], { hard })], hard };
          return { ...(await bulkDelete(ctx, args, { hard })), hard };
        }, (r) => ("needsConfirmation" in r && r.plan ? `Would delete ${r.plan.delete.length} record(s)${hard ? " permanently" : ""}. Re-run with --yes once the user agrees.` : `Deleted ${JSON.stringify(r.deleted)}`));
      }
      case "restore": {
        const id = positional(args, 0, "record id", U.restore);
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const { restoreRecord } = await import("../../src/ops/records");
          return recordOut(ctx, await restoreRecord(ctx, id));
        });
      }
      case "search": {
        const query = args.join(" ").trim();
        if (!query) usage("records search needs a query.", `Usage: agentcrm ${U.search}`);
        return withSession(io, options, {}, async ({ ctx }) => {
          const { searchRecords } = await import("../../src/ops/records");
          return searchRecords(ctx, query, { objects: listOpt(options, "object"), limit: Math.min(100, numOpt(options, "limit") ?? 20) });
        });
      }
      case "duplicates": {
        const objectId = object();
        return withSession(io, options, {}, async ({ ctx }) => {
          const { findDuplicates } = await import("../../src/ops/dedupe");
          const by = listOpt(options, "by") as DuplicateGroup["reason"][] | undefined;
          const groups = findDuplicates(ctx, objectId, by ? { by } : {});
          return { object: objectId, groups: groups.length, duplicates: groups };
        });
      }
      case "merge": {
        const [primary, ...dups] = args;
        if (!primary || !dups.length) usage("records merge needs <primaryId> <duplicateId>….", `Usage: agentcrm ${U.merge}`);
        return withSession(io, options, { lock: options.yes === true }, async ({ ctx }) => {
          const { getRecord } = await import("../../src/ops/records");
          const all = [primary, ...dups].map((id) => getRecord(ctx, id));
          const plan = { primary: await recordOut(ctx, all[0]), duplicates: await Promise.all(all.slice(1).map((r) => recordOut(ctx, r))) };
          if (options.yes !== true) return { needsConfirmation: true as const, plan };
          const { mergeRecords } = await import("../../src/ops/dedupe");
          const res = await mergeRecords(ctx, primary, dups);
          return { record: await recordOut(ctx, res.record), merged: res.merged, movedActivities: res.movedActivities };
        }, (r) => ("plan" in r && r.plan ? `Would merge ${r.plan.duplicates.length} duplicate(s) into ${r.plan.primary.id}. Re-run with --yes once the user agrees.` : "merged" in r ? `Merged ${r.merged.length} into ${r.record.id}` : ""));
      }
      case "image":
        return (await import("./files")).recordImageAction(io, options, args);
      case "sync": {
        const objectId = (Array.isArray(options.object) ? options.object[0] : options.object) as string | undefined;
        const key = strOpt(options, "key");
        const rowsRaw = strOpt(options, "rows");
        if (!objectId || !key || !rowsRaw) usage("records sync needs --object, --key and --rows.", `Usage: agentcrm ${U.sync}`);
        const { readTextValue } = await import("./util");
        let rows: unknown;
        try {
          rows = JSON.parse(readTextValue(rowsRaw!, "rows"));
        } catch (err) {
          usage(`--rows is not valid JSON: ${(err as Error).message}`);
        }
        if (!Array.isArray(rows)) usage("--rows must be a JSON array of { key, fields }.");
        const spec = { object: objectId!, key: key!, rows: rows as Array<{ key: string; fields: Record<string, unknown> }>, archiveField: strOpt(options, "archive-field"), refKey: strOpt(options, "ref-key") };
        const apply = options.yes === true;
        return withSession(io, options, { lock: apply }, async ({ ctx }) => {
          const { syncRecords } = await import("../../src/ops/syncRecords");
          if (apply) return syncRecords(ctx, spec);
          const { dryRun } = await import("../ops/dryRun");
          const { result } = await dryRun(ctx, (copy) => syncRecords(copy, spec));
          const pending = result.created + result.updated + result.archived;
          return pending ? { needsConfirmation: true as const, plan: result } : result;
        }, (r) => {
          const s = ("needsConfirmation" in r ? r.plan : r) as import("../../src/ops/syncRecords").SyncReport;
          const line = `${s.object}: ${s.rows} rows → ${s.created} new, ${s.updated} updated, ${s.unchanged} unchanged, ${s.archived} archived${s.unresolved ? `, ${s.unresolved} unresolved references` : ""}${s.errors.length ? `, ${s.errors.length} errors (first: ${s.errors[0].key}: ${s.errors[0].message})` : ""}`;
          return "needsConfirmation" in r ? `${line}\nNothing changed — re-run with --yes once the user agrees.` : line;
        });
      }
      default:
        usage(`Unknown records action "${action ?? ""}".`, "Use list, get, create, update, delete, restore, search, duplicates, merge, image or sync.");
    }
  },
};
