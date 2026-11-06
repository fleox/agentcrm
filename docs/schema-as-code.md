# Schema as code (`agentcrm schema apply`)

Keep the data model of a CRM — custom objects and fields, pipelines and shared views — in a JSON file under version control, and apply it with one command. Re-applying the same file changes nothing, so the file can be applied after every change, on every environment (a test CRM, then production), by a person, an agent or a CI job.

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 schema apply crm-schema.json --site acme          # plan: what would change
npx -y @fleox-agent-crm/agentcrm@0.12.0 schema apply crm-schema.json --site acme --yes    # apply it
cat crm-schema.json | npx -y @fleox-agent-crm/agentcrm@0.12.0 schema apply - --site acme  # from stdin
```

Admin only (`schema.write`; pipelines and shared views need the admin role too). Engine: `src/ops/schemaApply.ts` (`parseSchemaSpec`, `applySchema`); the CLI command is `agent/commands/schema.ts`.

## What it does — and never does

- **Creates** what is missing: objects, fields, select options, pipelines, stages, views.
- **Updates** what differs: object labels / icon / color / `labelField` / `imageField`; field label, description, `required`, `unique`, `hidden`, `currency`, `drilldown`, `rollup`; option colors; pipeline name and stages (label, kind, probability); view type, columns, filters, sorts, groupBy, pipelineId, shared.
- **Never deletes** anything: an object, field, option or stage the CRM has and the file doesn't is kept. Custom fields missing from the file are listed in `extraFields`; stages missing from the file stay after the listed ones.
- **Never changes a field type**: a type difference is reported in `conflicts` and that field is skipped. To migrate values to another type, use `agentcrm fields update <fieldId> --object <id> --type <type>` (it converts the stored values), then re-apply.
- **Never removes or renames a select option**: records store option ids. Options are matched by label (case-insensitive); a new label is added, an existing label given as `{ "label", "color" }` is recoloured (its id and the stored values stay).
- Not compared (set at creation only): a field's `relation`, `defaultValue` and `options` order; a stage's color.

Without `--yes` the whole file is applied to an in-memory copy of the dataset and the result is printed as the plan, so validation errors and conflicts show up before anything is written.

## Matching

| Item | Matched on |
|---|---|
| Object | `id` (standard objects `companies`, `people`, `deals` can be relabelled and extended) |
| Field | `id` within its object |
| Option | label, case-insensitive |
| Pipeline | `id` |
| Stage | `id` — **unique across every pipeline** (stages share one select field); an id already used by another pipeline is a conflict and the pipeline is not applied: prefix them (`p-prospect`) |
| View | object + `name`, among the views the acting user can see |

## Order of application

The file is applied in passes, so references may point forwards:

1. objects (a new object is created with its non-relation fields);
2. fields of every object (relations can target objects defined later in the file), then `labelField` and `imageField`;
3. `drilldown` and `rollup` of every field (they point at fields of other objects, which pass 2 may just have created);
4. pipelines;
5. views.

The apply is **atomic**: the passes run on an in-memory copy of the dataset and the result is saved in one write (one journal segment, one git commit; on Firebase, consecutive batches of up to 500 documents). If any item fails validation, whatever its pass, nothing is written.

## A complete, annotated file

The example below models gambling operators, the markets they hold a licence in, and the licences themselves. JSON has no comments: the notes follow the file.

```json
{
  "objects": [
    {
      "id": "markets", "labelSingular": "Market", "labelPlural": "Markets",
      "icon": "Globe", "color": "blue", "labelField": "name",
      "fields": [
        { "id": "name", "label": "Market", "type": "text", "required": true },
        { "id": "sourceId", "label": "Code", "type": "text", "unique": true },
        { "id": "operatorCount", "label": "Operators", "type": "number",
          "drilldown": { "object": "operators", "field": "markets" } }
      ]
    },
    {
      "id": "operators", "labelSingular": "Operator", "labelPlural": "Operators",
      "icon": "Building2", "labelField": "name", "imageField": "logoUrl",
      "fields": [
        { "id": "name", "label": "Operator", "type": "text" },
        { "id": "sourceId", "label": "Source id", "type": "text", "unique": true, "hidden": true },
        { "id": "logoUrl", "label": "Logo", "type": "url" },
        { "id": "markets", "label": "Markets", "type": "relation",
          "relation": { "object": "markets", "cardinality": "many" } },
        { "id": "status", "label": "Status", "type": "multiSelect",
          "options": [{ "label": "Live", "color": "green" }, { "label": "Pending", "color": "yellow" }, "Closed"],
          "rollup": { "object": "licences", "via": "operator", "field": "status",
                      "scope": { "field": "markets", "via": "market" },
                      "where": [{ "field": "archived", "op": "neq", "value": true }] } },
        { "id": "archived", "label": "Archived", "type": "boolean" }
      ]
    },
    {
      "id": "licences", "labelSingular": "Licence", "labelPlural": "Licences",
      "icon": "FileBadge", "labelField": "name",
      "fields": [
        { "id": "name", "label": "Licence", "type": "text" },
        { "id": "sourceId", "label": "Source id", "type": "text", "unique": true },
        { "id": "operator", "label": "Operator", "type": "relation",
          "relation": { "object": "operators", "cardinality": "one" } },
        { "id": "market", "label": "Market", "type": "relation",
          "relation": { "object": "markets", "cardinality": "one" } },
        { "id": "status", "label": "Status", "type": "select", "options": ["Live", "Pending", "Closed"] },
        { "id": "archived", "label": "Archived", "type": "boolean" }
      ]
    }
  ],
  "pipelines": [
    {
      "id": "partnerships", "name": "Partnerships", "object": "deals",
      "stages": [
        { "id": "p-prospect", "label": "Prospect", "probability": 10 },
        { "id": "p-signed", "label": "Signed", "probability": 100, "kind": "won" },
        { "id": "p-dropped", "label": "Dropped", "probability": 0, "kind": "lost" }
      ]
    }
  ],
  "views": [
    {
      "object": "operators", "name": "Live operators",
      "columns": ["name", "markets", "status"],
      "filters": [{ "field": "archived", "op": "neq", "value": true }],
      "sorts": [{ "field": "name", "dir": "asc" }],
      "shared": true
    }
  ]
}
```

Notes, top to bottom:

- **Objects** need `id` (a slug), `labelSingular` and `labelPlural`; `icon` is a [lucide](https://lucide.dev/icons) name, `color` an option color (`gray blue green yellow orange red purple pink teal indigo`). Every custom object comes with a `name` field: listing it (as here) only relabels it.
- **Fields** need `id`, `label` and `type` (`text longText number currency percent date datetime boolean select multiSelect email phone url relation user rating address tags image files`). Optional: `description`, `required`, `unique`, `hidden`, `options`, `currency` (ISO code), `relation` `{ object, cardinality: "one" | "many" }`, `defaultValue`.
- **`operatorCount` + `drilldown`** — the value becomes a link to the Operators list filtered on this market (`#/objects/operators?filter=markets:in:<marketId>`). `drilldown.field` must be a relation of `drilldown.object` pointing back at this object. The count itself is a plain number: something must write it (for example [`records sync`](sync.md)).
- **`imageField: "logoUrl"`** — the record avatar comes from a **URL field**: an `https://` image hosted elsewhere (a logo CDN) shows in lists, kanban cards, the search palette and the record header without any file storage; an image that fails to load falls back to the initials. An `image` field (stored file) works too. See [files.md](files.md#record-images-from-a-url).
- **`sourceId`** — on every mirrored object, the id of the record in the system it comes from (a market's ISO code, an operator's id): the key of [`records sync`](sync.md). Use the **same field id on every mirrored object**: one `records sync` run resolves all its relation references against one key field id. `hidden` keeps it out of default columns.
- **`status` + `rollup`** — the operator's status rolls up the `status` of its licences (`licences.operator` points at the operator). `scope` pairs the operator's `markets` relation with the licence's `market` relation (both must target the same object). The stored value covers every licence and is written by whoever maintains it (AgentCRM does not recompute stored values); while a list of operators is filtered on Markets (`eq`, `in` or `contains`), the list recomputes Status from the licences of the filtered markets only — see [data-model.md](data-model.md#drilldown-and-rollup-fields). `where` restricts the children counted. Child select values are matched to the parent's options by label.
- **Options** are labels or `{ "label", "color" }` objects.
- **Pipelines** need `id`, `name`, `object` and at least one stage; `stageField` defaults to the object's stage field (`stage` on deals). Stages need `id` and `label`; `kind` is `open` (default), `won` or `lost`; `probability` 0–100 (kept from the CRM when omitted). This is the CLI's way to create a pipeline.
- **Views** need `object` and `name`; `type` `table` (default) or `kanban` (with `groupBy` / `pipelineId`); filters use the [CLI filter ops](cli.md#conventions) (`{ field, op, value }`), sorts `{ field, dir }`. `shared: true` shows the view to every user (admin); otherwise it belongs to the acting user.

## Output

Plan (`--json`, nothing written):

```json
{ "ok": true, "data": { "needsConfirmation": true, "plan": {
  "changes": [
    { "kind": "object", "action": "create", "target": "markets", "changes": ["sourceId", "operatorCount"] },
    { "kind": "field", "action": "create", "target": "operators.markets", "changes": ["relation"] },
    { "kind": "object", "action": "update", "target": "operators", "changes": ["imageField"] },
    { "kind": "field", "action": "update", "target": "markets.operatorCount", "changes": ["drilldown"] },
    { "kind": "field", "action": "update", "target": "operators.status", "changes": ["options +Suspended", "colors Closed"] },
    { "kind": "pipeline", "action": "create", "target": "partnerships", "changes": ["p-prospect", "p-signed", "p-dropped"] },
    { "kind": "view", "action": "create", "target": "operators: Live operators" }
  ],
  "conflicts": ["markets.operatorCount: type is number in the CRM, text in the schema (not changed)"],
  "extraFields": ["markets.region"]
} } }
```

With `--yes`: the same report without `needsConfirmation` (`data.changes`, `data.conflicts`, `data.extraFields`). When the CRM already matches: `{ "changes": [], "conflicts": [], "extraFields": [], "upToDate": true }`. Conflicts and extra fields don't fail the command (exit 0): read them. An invalid file (missing ids, not JSON) is a usage error (exit 2); a definition that doesn't validate (a drilldown or rollup without the matching relation, an unknown filter operator, a kanban view without a select / user / boolean `groupBy`) is a validation error and, with `--yes`, nothing is written: the apply is all or nothing (see [Order of application](#order-of-application)).

Without `--json` the plan reads:

```text
Would change 1 thing(s):
  update field operators.status (options +Suspended, colors Closed)
  conflict: markets.operatorCount: type is number in the CRM, text in the schema (not changed)
  not in the schema (kept): markets.region
Nothing changed — re-run with --yes once the user agrees.
```

## In a repository

A pattern that works well: the schema file lives in the repository that also holds the [sync job](sync.md); a pull request runs the plan (`schema apply crm-schema.json --json` without `--yes`) so the reviewer sees `changes` / `conflicts`, and the merge to the main branch applies it (`--yes`) before the sync runs. The same file applied to an empty CRM builds the whole model.

Related: [`fields update --data`](cli.md#fields) sets or removes (`null`) a single `drilldown` / `rollup`; [data-model.md](data-model.md) for the stored formats.
