import { FIELD_TYPES, type FieldType } from "../../src/core/types";
import { withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, jsonObjectOpt, listOpt, positional, requireStr, SITE_OPTION, strOpt, table, usage, YES_OPTION } from "./util";

export const objectsCommand: Command = {
  name: "objects",
  usage: "objects <list|get|create|update|delete> …",
  summary: "The data model: list objects, describe one (fields, types, select options, relations, pipelines), create custom objects, rename / recolor, delete a custom object (admin).",
  subcommands: [
    { name: "list", usage: "objects list", summary: "Objects with record counts." },
    { name: "get", usage: "objects get <id>", summary: "Fields (ids, types, options, relations) and pipelines of one object — read it before writing records." },
    { name: "create", usage: "objects create --singular <label> --plural <label> [--id <slug>] [--icon <name>] [--color <c>] [--data <json>]", summary: "Create a custom object (with a name field; add fields with `fields add`).", writes: true },
    { name: "update", usage: "objects update <id> [--singular …] [--plural …] [--icon …] [--color …] [--label-field <fieldId>]", summary: "Rename, change icon / color / label field.", writes: true },
    { name: "delete", usage: "objects delete <id> [--yes]", summary: "Delete a custom object, ALL its records, its views and relation fields pointing at it. Plan unless --yes.", writes: true, destructive: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "singular", type: "string", description: "Singular label." },
    { name: "plural", type: "string", description: "Plural label." },
    { name: "id", type: "string", description: "create: object id (slug; default from the plural label)." },
    { name: "icon", type: "string", description: "Icon name (lucide)." },
    { name: "color", type: "string", description: "Color name." },
    { name: "label-field", type: "string", description: "update: field used as the record label." },
    { name: "data", type: "string", description: "create: full ObjectInput JSON (with fields) or @file." },
  ],
  async run({ io, options, positionals }) {
    const [action = "list", id] = positionals;
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx, store }) => {
          const { listObjects } = await import("../../src/ops/schema");
          const { recordsOf } = await import("../../src/ops/store");
          return listObjects(ctx).map((o) => ({ id: o.id, labelSingular: o.labelSingular, labelPlural: o.labelPlural, standard: o.standard, labelField: o.labelField, fields: o.fields.length, records: recordsOf(store, o.id).length }));
        }, (rows) => table(rows, ["id", "labelPlural", "fields", "records", "standard"]));
      case "get": {
        const objectId = positional(positionals, 1, "object id", "objects get <id>");
        // One object in, one object out (describeSchema lists every object).
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/schema")).describeSchema(ctx, objectId)[0]);
      }
      case "create": {
        const data = jsonObjectOpt(options, "data") ?? {};
        const input = {
          ...data,
          ...(strOpt(options, "id") ? { id: strOpt(options, "id") } : {}),
          labelSingular: strOpt(options, "singular") ?? (data.labelSingular as string | undefined),
          labelPlural: strOpt(options, "plural") ?? (data.labelPlural as string | undefined),
          ...(strOpt(options, "icon") ? { icon: strOpt(options, "icon") } : {}),
          ...(strOpt(options, "color") ? { color: strOpt(options, "color") } : {}),
        };
        if (!input.labelSingular || !input.labelPlural) usage("objects create needs --singular and --plural (or --data).");
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/schema")).createObject(ctx, input as Parameters<typeof import("../../src/ops/schema").createObject>[1]));
      }
      case "update": {
        const objectId = positional(positionals, 1, "object id", "objects update <id> …");
        const patch = {
          ...(strOpt(options, "singular") ? { labelSingular: strOpt(options, "singular") } : {}),
          ...(strOpt(options, "plural") ? { labelPlural: strOpt(options, "plural") } : {}),
          ...(strOpt(options, "icon") ? { icon: strOpt(options, "icon") } : {}),
          ...(strOpt(options, "color") ? { color: strOpt(options, "color") } : {}),
          ...(strOpt(options, "label-field") ? { labelField: strOpt(options, "label-field") } : {}),
        };
        if (!Object.keys(patch).length) usage("objects update needs --singular, --plural, --icon, --color or --label-field.");
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/schema")).updateObject(ctx, objectId, patch));
      }
      case "delete": {
        if (!id) usage("objects delete needs an object id.");
        return withSession(io, options, { lock: options.yes === true }, async ({ ctx, store }) => {
          const { getObject, deleteObject } = await import("../../src/ops/schema");
          const { recordsOf } = await import("../../src/ops/store");
          const o = getObject(ctx, id);
          const plan = { object: o.id, label: o.labelPlural, standard: o.standard, recordsDeleted: recordsOf(store, o.id, { includeDeleted: true }).length };
          if (options.yes !== true) return { needsConfirmation: true as const, plan };
          return deleteObject(ctx, id);
        });
      }
      default:
        usage(`Unknown objects action "${action}".`, "Use list, get, create, update or delete.");
    }
  },
};

export const fieldsCommand: Command = {
  name: "fields",
  usage: "fields <add|update|delete> --object <id> …",
  summary: "Custom fields: add (any type, select options, relations), update (label, options, required, type change with data migration), delete (values cleared). Admin only.",
  subcommands: [
    { name: "add", usage: `fields add --object <id> --label <label> --type <${FIELD_TYPES.join("|")}> [--options a,b,c] [--relation-object <id> --cardinality one|many] [--required] [--unique] [--description …] [--id <fieldId>]`, summary: "Add a field.", writes: true },
    { name: "update", usage: "fields update <fieldId> --object <id> [--label …] [--options a,b] [--type <t>] [--required|--optional] [--data <json>]", summary: "Change a field (type changes migrate existing values).", writes: true },
    { name: "delete", usage: "fields delete <fieldId> --object <id> [--yes]", summary: "Delete a custom field and clear its values. Plan unless --yes.", writes: true, destructive: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "object", type: "string", description: "Object id." },
    { name: "label", type: "string", description: "Field label." },
    { name: "type", type: "string", description: `Field type: ${FIELD_TYPES.join(", ")}.` },
    { name: "id", type: "string", description: "add: field id (default: camelCase of the label)." },
    { name: "options", type: "string", description: "select / multiSelect option labels, comma-separated." },
    { name: "relation-object", type: "string", description: "relation: target object id." },
    { name: "cardinality", type: "string", description: "relation: one (default) or many." },
    { name: "required", type: "boolean", description: "Value required." },
    { name: "optional", type: "boolean", description: "update: no longer required." },
    { name: "unique", type: "boolean", description: "Values must be unique." },
    { name: "description", type: "string", description: "Help text." },
    { name: "data", type: "string", description: "update: raw FieldPatch JSON." },
  ],
  async run({ io, options, positionals }) {
    const [action, fieldId] = positionals;
    const objectId = requireStr(options, "object", "Objects: `agentcrm objects list`.");
    switch (action) {
      case "add": {
        const type = requireStr(options, "type") as FieldType;
        if (!FIELD_TYPES.includes(type)) usage(`Unknown field type "${type}".`, `Types: ${FIELD_TYPES.join(", ")}.`);
        const rel = strOpt(options, "relation-object");
        if (type === "relation" && !rel) usage("relation fields need --relation-object <id>.");
        const input = {
          label: requireStr(options, "label"),
          type,
          ...(strOpt(options, "id") ? { id: strOpt(options, "id") } : {}),
          ...(listOpt(options, "options") ? { options: listOpt(options, "options") } : {}),
          ...(rel ? { relation: { object: rel, cardinality: strOpt(options, "cardinality") === "many" ? ("many" as const) : ("one" as const) } } : {}),
          ...(boolOpt(options, "required") ? { required: true } : {}),
          ...(boolOpt(options, "unique") ? { unique: true } : {}),
          ...(strOpt(options, "description") ? { description: strOpt(options, "description") } : {}),
        };
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/schema")).createField(ctx, objectId, input));
      }
      case "update": {
        if (!fieldId) usage("fields update needs a field id.");
        const type = strOpt(options, "type") as FieldType | undefined;
        if (type && !FIELD_TYPES.includes(type)) usage(`Unknown field type "${type}".`);
        const patch = {
          ...(jsonObjectOpt(options, "data") ?? {}),
          ...(strOpt(options, "label") ? { label: strOpt(options, "label") } : {}),
          ...(listOpt(options, "options") ? { options: listOpt(options, "options") } : {}),
          ...(type ? { type } : {}),
          ...(boolOpt(options, "required") ? { required: true } : {}),
          ...(boolOpt(options, "optional") ? { required: false } : {}),
          ...(boolOpt(options, "unique") ? { unique: true } : {}),
          ...(strOpt(options, "description") !== undefined ? { description: strOpt(options, "description") } : {}),
        };
        if (!Object.keys(patch).length) usage("fields update needs at least one change.");
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/schema")).updateField(ctx, objectId, fieldId, patch));
      }
      case "delete": {
        if (!fieldId) usage("fields delete needs a field id.");
        return withSession(io, options, { lock: options.yes === true }, async ({ ctx, store }) => {
          const { getObject, deleteField } = await import("../../src/ops/schema");
          const { recordsOf } = await import("../../src/ops/store");
          const field = getObject(ctx, objectId).fields.find((f) => f.id === fieldId);
          if (!field) usage(`No field "${fieldId}" on ${objectId}.`, `\`agentcrm objects get ${objectId}\` lists them.`);
          const plan = { object: objectId, field: field.id, label: field.label, standard: !!field.standard, valuesCleared: recordsOf(store, objectId).filter((r) => r.fields[fieldId] !== undefined).length };
          if (options.yes !== true) return { needsConfirmation: true as const, plan };
          return deleteField(ctx, objectId, fieldId);
        });
      }
      default:
        usage(`Unknown fields action "${action ?? ""}".`, "Use add, update or delete.");
    }
  },
};
