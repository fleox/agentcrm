import { resolve } from "node:path";
import { FILTER_OPS } from "../../src/core/types";
import type { CollectionName } from "../../src/data/types";
import { withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, jsonObjectOpt, listOpt, multiOpt, numOpt, parseFilters, parseSorts, positional, readTextValue, requireStr, SITE_OPTION, strOpt, table, usage, writeOutFile, YES_OPTION } from "./util";

// --map '{"Header":"field"}' or --map "Header=field,Other=field2" (or @file).
function mappingOpt(options: Record<string, unknown>): Record<string, string> | undefined {
  const raw = typeof options.map === "string" ? readTextValue(options.map, "map").trim() : undefined;
  if (!raw) return undefined;
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      usage(`--map is not valid JSON: ${(err as Error).message}`);
    }
  }
  return Object.fromEntries(
    raw.split(",").map((pair) => {
      const i = pair.lastIndexOf("=");
      if (i <= 0) usage(`--map expects Header=field pairs, got "${pair}".`);
      return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
    }),
  );
}

export const importCommand: Command = {
  name: "import",
  usage: "import csv <file|-> --object <id> [--map <json|Header=field,…>] [--dedupe update|skip|create] [--delimiter ;] [--day-first] [--yes]",
  summary: "Import a CSV into an object: columns mapped to fields automatically (or with --map), values coerced, duplicates (people by email, companies by domain, else by name) updated / skipped. DRY RUN by default — the report shows every row's outcome; --yes applies.",
  subcommands: [
    { name: "csv", usage: "import csv <file|-> --object <id> [--map …] [--dedupe update|skip|create] [--yes]", summary: "Dry run (default) or apply (--yes).", writes: true },
    { name: "zip", usage: "import zip <backup.zip> [--replace] [--yes]", summary: "Restore a backup ZIP (data + files; merge, or --replace). Plan unless --yes.", writes: true, destructive: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "object", type: "string", description: "Target object id." },
    { name: "map", type: "string", description: 'Column mapping: JSON {"Header":"fieldId"} or "Header=fieldId,…" ("" skips a column, $owner / $id special).' },
    { name: "dedupe", type: "string", description: "Existing duplicate: update (default), skip, or create anyway." },
    { name: "delimiter", type: "string", description: "Column delimiter (default: detected)." },
    { name: "day-first", type: "boolean", description: "Ambiguous dates are DD/MM/YYYY." },
    { name: "no-create-options", type: "boolean", description: "Don't add unknown select values as new options." },
    { name: "dry-run", type: "boolean", description: "Explicit dry run (the default without --yes)." },
    { name: "rows", type: "string", description: "Rows shown in the report (default 100)." },
    { name: "replace", type: "boolean", description: "zip: also delete documents absent from the backup." },
  ],
  async run({ io, options, positionals }) {
    const [kind, file] = positionals;
    if (kind === "zip") {
      const path = positional(positionals, 1, "backup ZIP", "import zip <backup.zip> [--yes]");
      const { existsSync, readFileSync } = await import("node:fs");
      if (!existsSync(path)) usage(`${path} does not exist.`);
      const bytes = new Uint8Array(readFileSync(path));
      if (options.yes !== true) {
        // Validates the archive and counts what would change (read-only session).
        return withSession(io, options, {}, async ({ ctx }) => {
          const plan = await (await import("../../src/ops/backup")).planBackupZip(ctx, bytes, { mode: options.replace === true ? "replace" : "merge" });
          return { needsConfirmation: true as const, plan: { restore: resolve(path), bytes: bytes.length, ...plan } };
        }, (r) =>
          [
            `Would restore ${r.plan.restore} (${r.plan.mode}): ${r.plan.added} new, ${r.plan.overwritten} overwritten, ${r.plan.deleted} deleted document(s), ${r.plan.files} file(s).`,
            ...r.plan.warnings.map((w) => `Warning: ${w}`),
            "Nothing changed. Re-run with --yes to apply.",
          ].join("\n"),
        );
      }
      return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/backup")).importBackupZip(ctx, bytes, { mode: options.replace === true ? "replace" : "merge" }), (r) => `Restored ${r.written} document(s) and ${r.files} file(s)`);
    }
    if (kind !== "csv") usage('Only "import csv" and "import zip" are supported.', "Usage: agentcrm import csv <file> --object <id>");
    const source = positional(positionals, 1, "CSV file (or -)", "import csv <file|-> --object <id>");
    const csv = readTextValue(source === "-" ? "-" : `@${source}`, "file");
    void file;
    const objectId = requireStr(options, "object");
    const dedupe = (strOpt(options, "dedupe") ?? "update") as "update" | "skip" | "create";
    if (!["update", "skip", "create"].includes(dedupe)) usage("--dedupe must be update, skip or create.");
    const apply = options.yes === true && options["dry-run"] !== true;
    const shown = numOpt(options, "rows") ?? 100;
    return withSession(io, options, { lock: apply }, async ({ ctx }) => {
      const { importCsv } = await import("../../src/ops/importCsv");
      const report = await importCsv(ctx, {
        object: objectId,
        csv,
        mapping: mappingOpt(options),
        onDuplicate: dedupe,
        dryRun: !apply,
        dayFirst: boolOpt(options, "day-first"),
        createOptions: !boolOpt(options, "no-create-options"),
        delimiter: strOpt(options, "delimiter"),
      });
      return { ...report, ...(apply ? {} : { needsConfirmation: true }), rows: report.rows.slice(0, shown), rowsTruncated: report.rows.length > shown };
    }, (r) =>
      [
        `${r.dryRun ? "DRY RUN — " : ""}${r.total} row(s): ${r.created} create, ${r.updated} update, ${r.skipped} skip, ${r.failed} error`,
        `Mapping: ${Object.entries(r.mapping).map(([h, f]) => `${h} → ${f || "(skip)"}`).join(", ")}`,
        ...r.rows.filter((x) => x.action === "error").map((x) => `  row ${x.row}: ${(x.messages ?? []).join("; ")}`),
        ...(r.dryRun ? ["Nothing changed. Re-run with --yes to apply."] : []),
      ].join("\n"));
  },
};

export const exportCommand: Command = {
  name: "export",
  usage: "export <csv|json|zip> …",
  summary: "Export one object as CSV (labels or raw values, filters, columns), the whole dataset as JSON (backup / migration, re-importable), or a ZIP backup with data + files.",
  subcommands: [
    { name: "csv", usage: "export csv --object <id> [--out <file>] [--filter f:op:v]… [--sort f] [--columns a,b] [--view <id>] [--raw] [--deleted]", summary: "CSV of one object." },
    { name: "json", usage: "export json [--out <file>] [--collections records,activities,…]", summary: "Whole dataset (or some collections) as JSON." },
    { name: "zip", usage: "export zip --out <file.zip> [--no-files]", summary: "Backup ZIP: data.json + the (decrypted) bytes of every file. Not encrypted: keep it safe." },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    { name: "object", type: "string", description: "csv: object id." },
    { name: "out", type: "string", description: "Write to this file (default: stdout / the JSON result)." },
    { name: "filter", type: "string", description: "field:op:value (repeatable).", multiple: true },
    { name: "sort", type: "string", description: "field[:desc] (repeatable).", multiple: true },
    { name: "columns", type: "string", description: "Field ids to export." },
    { name: "view", type: "string", description: "Apply a saved view." },
    { name: "raw", type: "boolean", description: "Stored values (ids, ISO dates) instead of labels." },
    { name: "deleted", type: "boolean", description: "Include soft-deleted records." },
    { name: "collections", type: "string", description: "json: collections to export." },
    { name: "no-files", type: "boolean", description: "zip: data only (no file bytes)." },
  ],
  async run({ io, options, positionals }) {
    const [kind] = positionals;
    if (kind === "zip") {
      const file = strOpt(options, "out");
      if (!file) usage("export zip needs --out <file.zip>.");
      return withSession(io, options, {}, async ({ ctx }) => {
        const { exportBackupZip } = await import("../../src/ops/backup");
        const { zip, report } = await exportBackupZip(ctx, { includeFiles: options["no-files"] !== true });
        writeOutFile(file, zip);
        return { file: resolve(file), zipBytes: zip.length, files: report.files, missing: report.missing, fileBytes: report.bytes };
      }, (r) => `Wrote ${r.zipBytes} bytes (${r.files} file(s)${r.missing.length ? `, ${r.missing.length} missing` : ""}) to ${r.file}`);
    }
    const out = strOpt(options, "out");
    const deliver = (text: string, extra: Record<string, unknown>): Record<string, unknown> => {
      if (out) {
        writeOutFile(out, text);
        return { file: resolve(out), bytes: Buffer.byteLength(text), ...extra };
      }
      return { ...extra, content: text };
    };
    if (kind === "csv") {
      const objectId = requireStr(options, "object");
      const filters = parseFilters(multiOpt(options, "filter"), FILTER_OPS);
      const sorts = parseSorts(multiOpt(options, "sort"));
      return withSession(io, options, {}, async ({ ctx }) => {
        const { exportCsv } = await import("../../src/ops/exportCsv");
        const csv = exportCsv(ctx, objectId, {
          viewId: strOpt(options, "view"),
          filters,
          sorts,
          fields: listOpt(options, "columns"),
          values: boolOpt(options, "raw") ? "raw" : "labels",
          includeDeleted: boolOpt(options, "deleted"),
        });
        // Records, not lines: quoted values may hold line breaks.
        const { default: Papa } = await import("papaparse");
        const rows = Math.max(0, Papa.parse(csv, { skipEmptyLines: true }).data.length - 1);
        return deliver(csv, { object: objectId, rows });
      }, (r) => ("content" in r ? String(r.content) : `Wrote ${String(r.rows)} row(s) to ${String(r.file)}`));
    }
    if (kind === "json") {
      return withSession(io, options, {}, async ({ ctx }) => {
        const { exportJson } = await import("../../src/ops/exportCsv");
        const data = exportJson(ctx, { collections: listOpt(options, "collections") as CollectionName[] | undefined });
        const text = JSON.stringify(data, null, 2);
        if (out) return deliver(text, {});
        return { export: data } as Record<string, unknown>;
      }, (r) => ("export" in r ? JSON.stringify(r.export, null, 2) : `Wrote ${String(r.bytes)} bytes to ${String(r.file)}`));
    }
    usage(`Unknown export kind "${kind ?? ""}".`, "Use export csv, export json or export zip.");
  },
};

export const REPORT_ALIASES: Record<string, string> = {
  pipeline: "pipelineByStage",
  forecast: "forecast",
  "won-lost": "wonLost",
  activity: "activityByUser",
  "lead-sources": "leadSources",
  stale: "staleDeals",
  conversion: "conversion",
};

export const reportCommand: Command = {
  name: "report",
  usage: "report <pipeline|forecast|won-lost|activity|lead-sources|stale|conversion> [--months n] [--days n] [--pipeline <id>] [--owner <userId>] [--params <json>]",
  summary: "Sales reports: pipeline by stage, weighted forecast, won / lost per month (win rate), activity per user, lead sources, stale deals, lifecycle conversion funnel.",
  subcommands: Object.keys(REPORT_ALIASES).map((name) => ({ name, usage: `report ${name}`, summary: `The ${name} report.` })),
  options: [
    SITE_OPTION,
    AS_OPTION,
    { name: "months", type: "string", description: "won-lost: months back (default 6)." },
    { name: "days", type: "string", description: "activity / stale: days (default 30 / settings.staleDealDays)." },
    { name: "pipeline", type: "string", description: "Pipeline id." },
    { name: "owner", type: "string", description: "Only deals owned by this user id." },
    { name: "params", type: "string", description: "Raw report parameters (JSON)." },
  ],
  async run({ io, options, positionals }) {
    const name = positional(positionals, 0, "report name", "report <name>");
    const internal = REPORT_ALIASES[name] ?? name;
    if (!Object.values(REPORT_ALIASES).includes(internal)) usage(`Unknown report "${name}".`, `Reports: ${Object.keys(REPORT_ALIASES).join(", ")}.`);
    const params: Record<string, unknown> = {
      ...(jsonObjectOpt(options, "params") ?? {}),
      ...(numOpt(options, "months") !== undefined ? { months: numOpt(options, "months") } : {}),
      ...(numOpt(options, "days") !== undefined ? { days: numOpt(options, "days") } : {}),
      ...(strOpt(options, "pipeline") ? { pipelineId: strOpt(options, "pipeline") } : {}),
      ...(strOpt(options, "owner") ? { ownerId: strOpt(options, "owner") } : {}),
    };
    let text = "";
    return withSession(io, options, {}, async ({ ctx }) => {
      const out = { report: name, data: (await import("../../src/ops/reports")).runReport(ctx, internal, params) };
      if (!io.json) {
        const { humanFormat, reportText } = await import("./human");
        text = reportText(await humanFormat(ctx), internal, out.data);
      }
      return out;
    }, () => text);
  },
};

export const statsCommand: Command = {
  name: "stats",
  usage: "stats [--site <alias>]",
  summary: "Dataset overview: records per object, activities by type, open / overdue tasks, users, open pipeline (+ journal segments).",
  options: [SITE_OPTION, AS_OPTION],
  async run({ io, options }) {
    return withSession(io, options, {}, async ({ ctx, store }) => {
      const stats = (await import("../../src/ops/stats")).getStats(ctx);
      const journal = (store as { stats?: () => Promise<unknown> }).stats;
      return { ...stats, ...(journal ? { journal: await journal.call(store) } : {}) };
    }, (s) => [`backend: ${s.backend}`, ...s.objects.map((o) => `  ${o.label}: ${o.count}${o.deleted ? ` (+${o.deleted} deleted)` : ""}`), `open tasks: ${s.openTasks} (${s.overdueTasks} overdue)`, `users: ${s.users}`].join("\n"));
  },
};

export const compactCommand: Command = {
  name: "compact",
  usage: "compact [--older-than <days>] [--keep-runs <n>] [--yes]",
  summary: "Physical purge (GDPR erasure): hard-deletes soft-deleted records and activities and old automation runs, deletes the bytes of deleted / orphan files, then rewrites the storage without history (journal: new snapshot, merged segments deleted). Plan unless --yes.",
  options: [SITE_OPTION, AS_OPTION, YES_OPTION, { name: "older-than", type: "string", description: "Only items deleted more than N days ago (default: all)." }, { name: "keep-runs", type: "string", description: "Automation runs kept (default 500)." }],
  async run({ io, options }) {
    const apply = options.yes === true;
    return withSession(io, options, { lock: apply }, async ({ ctx }) => {
      const { compactData } = await import("../../src/ops/compact");
      const report = await compactData(ctx, { olderThanDays: numOpt(options, "older-than"), keepRuns: numOpt(options, "keep-runs"), dryRun: !apply });
      return apply ? report : { needsConfirmation: true, plan: report };
    }, (r) => ("plan" in r ? `Would purge ${r.plan.purgedRecords.length} record(s), ${r.plan.purgedActivities} activit(ies), ${r.plan.purgedRuns} run(s), ${r.plan.purgedFiles} file(s).\nNothing changed. Re-run with --yes to apply.` : `Purged ${r.purgedRecords.length} record(s), ${r.purgedFiles} file(s); storage compacted: ${r.storageCompacted}`));
  },
};

export const automationsCommand: Command = {
  name: "automations",
  usage: "automations <list|enable|disable|run> …",
  summary: "Automations (event triggers run in-process on every write, also from the CLI): list, enable / disable, run the scheduled & inactivity ones (cron / GitHub Actions). `run` is a dry run unless --yes.",
  subcommands: [
    { name: "list", usage: "automations list", summary: "Automations with trigger, enabled state and last run." },
    { name: "enable", usage: "automations enable <id>", summary: "Enable an automation.", writes: true },
    { name: "disable", usage: "automations disable <id>", summary: "Disable an automation.", writes: true },
    { name: "run", usage: "automations run [--id <automationId>] [--force] [--yes]", summary: "Evaluate schedule / inactivity triggers now (runScheduled). Dry run unless --yes.", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, YES_OPTION, { name: "id", type: "string", description: "run: only this automation." }, { name: "force", type: "boolean", description: "run: ignore the everyHours spacing." }],
  async run({ io, options, positionals }) {
    const [action = "list", id] = positionals;
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/automations")).listAutomations(ctx).map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, object: a.object, trigger: a.trigger, actions: a.actions.map((x) => x.type), lastRunAt: a.lastRunAt ? new Date(a.lastRunAt).toISOString() : null })), (rows) => table(rows, ["id", "name", "enabled", "object", "lastRunAt"]));
      case "enable":
      case "disable": {
        if (!id) usage(`automations ${action} needs an id.`);
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const mod = await import("../../src/ops/automations");
          return mod.setAutomationEnabled(ctx, id, action === "enable");
        });
      }
      case "run": {
        const apply = options.yes === true;
        return withSession(io, options, { lock: apply }, async ({ ctx }) => {
          const { runScheduled } = await import("../../src/ops/automations");
          const report = await runScheduled(ctx, { dryRun: !apply, automationId: strOpt(options, "id"), force: boolOpt(options, "force") });
          return apply ? report : { needsConfirmation: true, ...report };
        }, (r) => `${"needsConfirmation" in r ? "DRY RUN — " : ""}ran ${r.ran}, skipped ${r.skipped}, errors ${r.errors}`);
      }
      default:
        usage(`Unknown automations action "${action}".`, "Use list, enable, disable or run.");
    }
  },
};

export const formsCommand: Command = {
  name: "forms",
  usage: "forms <list|publish|ingest> …",
  summary: "Lead capture forms: list, publish the static form page to the hosting, ingest pending submissions from the inbox (records created / deduped, activity logged). publish and ingest print a plan / dry run unless --yes.",
  subcommands: [
    { name: "list", usage: "forms list", summary: "Forms with their inbox and published URL." },
    { name: "publish", usage: "forms publish <formId> [--yes]", summary: "Upload the form page (+ print the embed snippet).", writes: true },
    { name: "ingest", usage: "forms ingest [--form <id>] [--limit n] [--yes]", summary: "Turn inbox submissions into records. Dry run unless --yes.", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, YES_OPTION, { name: "form", type: "string", description: "ingest: only this form." }, { name: "limit", type: "string", description: "ingest: max submissions." }],
  async run({ io, options, positionals }) {
    const [action = "list", id] = positionals;
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/forms")).listForms(ctx), (fs) => table(fs as unknown as Record<string, unknown>[], ["id", "name", "object", "publishedPath"]));
      case "publish": {
        if (!id) usage("forms publish needs a form id.");
        return withSession(io, options, { lock: options.yes === true }, async (s) => {
          const forms = await import("../../src/ops/forms");
          const built = await forms.buildFormHtml(s.ctx, id);
          const target = s.hostingTarget();
          if (!target) usage(`${s.site.alias} has no hosting to publish the form to.`);
          if (options.yes !== true) return { needsConfirmation: true as const, plan: { form: id, path: built.path, hosting: s.site.hosting?.type, bytes: built.html.length } };
          const { buildConnector } = await import("../ops/hosting");
          const connector = buildConnector(target);
          const siteUrl = typeof s.site.hosting?.settings.siteUrl === "string" ? s.site.hosting.settings.siteUrl.replace(/\/+$/, "") : "";
          return forms.publishForm(s.ctx, id, { put: (input) => connector.put(input), publicUrl: async (path) => (siteUrl ? `${siteUrl}/${path}` : connector.publicUrl(path)) });
        });
      }
      case "ingest": {
        const apply = options.yes === true;
        return withSession(io, options, { lock: apply }, async ({ ctx }) => {
          const { ingestInbox } = await import("../../src/ops/forms");
          const report = await ingestInbox(ctx, strOpt(options, "form"), { dryRun: !apply, limit: numOpt(options, "limit") });
          return apply ? report : { needsConfirmation: true, ...report };
        }, (r) => `${"needsConfirmation" in r ? "DRY RUN — " : ""}processed ${r.processed}: ${r.created} created, ${r.updated} updated, ${r.failed} failed`);
      }
      default:
        usage(`Unknown forms action "${action}".`, "Use list, publish or ingest.");
    }
  },
};
