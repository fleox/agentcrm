# Data model, views, users, settings

All schema commands need the admin role.

## Objects

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 objects list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 objects get deals --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 objects create --site acme --singular Project --plural Projects --icon folder --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 objects update projects --site acme --plural "Client projects" --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 objects delete projects --site acme --json
```

Deleting an object deletes all its records (plan first).

## Fields

Types: text, longText, number, currency, percent, date, datetime, boolean, select, multiSelect, email, phone, url, relation, user, rating, address, tags, image (one picture; the first one becomes the record avatar), files (attachments).

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 fields add --site acme --object deals --label "Contract type" --type select --options "New,Renewal,Upsell" --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 fields add --site acme --object projects --label Client --type relation --relation-object companies --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 fields update contractType --site acme --object deals --options "New,Renewal,Upsell,Cross-sell" --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 fields delete contractType --site acme --object deals --json
```

`fields update --type <t>` converts existing values (the result reports what could not be converted). Standard fields can't be deleted.

### Record image from a URL field

An object's avatar / logo (`imageField`) can be an `image` field (uploaded file) or a **`url` field** holding a remote image (e.g. a logo CDN): it shows in lists, kanban cards, search and the record header without any upload or Firebase Storage; a broken URL falls back to the initials. Set it with `schema apply` (`"imageField": "logoUrl"` on the object, see below).

### Drilldown and rollup fields (`fields update --data`)

`fields add` creates the field; `fields update <fieldId> --object <id> --data '<json>'` sets the raw field options it has no flag for (also accepted in `schema apply`). Both are validated: the relations they name must exist.

- **Drilldown**: the value links to another object's list filtered on this record. `drilldown: { object, field }`, where `field` is a relation of `object` pointing back here. A market's company count opening the companies of that market:

  ```bash
  npx -y @fleox-agent-crm/agentcrm@0.12.0 fields add --site acme --object markets --label Companies --id companyCount --type number --json
  npx -y @fleox-agent-crm/agentcrm@0.12.0 fields update companyCount --site acme --object markets --data '{"drilldown":{"object":"companies","field":"markets"}}' --json
  ```

- **Scoped rollup**: the field holds the values of a child object (each company's status on each of its markets). `rollup: { object, via, field, scope?, where? }`: `object` = the child, `via` = its relation to this object, `field` = the child field collected, `scope = { field, via }` = a relation of this object (`markets`) and the child's relation to the same target (`market`), `where` = filters on the children. The stored value (written by you or `records sync`) covers every child; a list filtered on the scope relation (Markets = FR) recomputes the cells, filters and sorts from the children in that scope, and those columns are read-only inline while the filter is on. Use a `multiSelect` with the child's option labels (matched by label).

  ```bash
  npx -y @fleox-agent-crm/agentcrm@0.12.0 fields add --site acme --object companies --label "Market status" --id marketStatus --type multiSelect --options "Live,Paused,Closed" --json
  npx -y @fleox-agent-crm/agentcrm@0.12.0 fields update marketStatus --site acme --object companies --data '{"rollup":{"object":"presences","via":"company","field":"status","scope":{"field":"markets","via":"market"}}}' --json
  ```

  `--data '{"drilldown":null}'` (or `rollup`) removes it.

## Schema as code (`schema apply`)

The best way to set up or evolve a whole data model: write it as one JSON file (keep it in the user's repository), show the plan, apply. It is **additive, idempotent and atomic** (one write: if any item fails validation, nothing is applied): it creates what is missing and updates what differs (labels, icons, colors, required / unique / hidden, new select options, option colors given as `{ label, color }`, `imageField`, drilldowns, rollups, pipeline stages, views); it never deletes anything, never changes a field type (reported in `conflicts`; use `fields update --type`) and never removes a select option or a stage. Custom fields the file doesn't list are reported in `extraFields` and left alone. It is also the CLI's way to **create pipelines and add stages**.

`crm-schema.json`:

```json
{
  "objects": [
    {
      "id": "markets", "labelSingular": "Market", "labelPlural": "Markets", "icon": "Globe", "color": "teal", "labelField": "name",
      "fields": [
        { "id": "name", "label": "Market", "type": "text" },
        { "id": "code", "label": "Code", "type": "text", "unique": true },
        { "id": "regulated", "label": "Regulated", "type": "boolean" },
        { "id": "companyCount", "label": "Companies", "type": "number", "drilldown": { "object": "companies", "field": "markets" } }
      ]
    },
    {
      "id": "companies", "labelSingular": "Company", "labelPlural": "Companies", "imageField": "logoUrl",
      "fields": [
        { "id": "logoUrl", "label": "Logo URL", "type": "url" },
        { "id": "markets", "label": "Markets", "type": "relation", "relation": { "object": "markets", "cardinality": "many" } },
        { "id": "tier", "label": "Tier", "type": "select", "options": [{ "label": "Gold", "color": "amber" }, "Silver", "Bronze"] }
      ]
    }
  ],
  "pipelines": [
    {
      "id": "partnerships", "name": "Partnerships", "object": "deals",
      "stages": [
        { "id": "prospect", "label": "Prospect", "probability": 10 },
        { "id": "signed", "label": "Signed", "probability": 100, "kind": "won" },
        { "id": "dropped", "label": "Dropped", "probability": 0, "kind": "lost" }
      ]
    }
  ],
  "views": [
    { "object": "companies", "name": "Gold companies", "columns": ["name", "tier", "markets"], "filters": [{ "field": "tier", "op": "eq", "value": "Gold" }], "shared": true }
  ]
}
```

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 schema apply crm-schema.json --site acme --json        # plan: needsConfirmation + plan.changes / conflicts / extraFields
npx -y @fleox-agent-crm/agentcrm@0.12.0 schema apply crm-schema.json --site acme --yes --json  # apply, after the user agreed
npx -y @fleox-agent-crm/agentcrm@0.12.0 schema apply crm-schema.json --site acme --json        # again: upToDate: true
```

- Workflow: `objects list` / `objects get` first, write the file, run the plan, show `changes` (`create` / `update` + what), `conflicts` and `extraFields` to the user, then `--yes`. A second plan must say `upToDate: true`.
- Existing objects (standard ones included) are matched by `id`: list only the fields you add or change, and repeat the object's current `labelSingular` / `labelPlural` (they are compared too: other labels rename the object). Relations may point at objects defined later in the file; drilldowns and rollups are applied last, once every relation exists.
- Objects need `id`, `labelSingular`, `labelPlural`; fields `id`, `label`, `type`; pipelines `id`, `name`, `object`, `stages` (`id`, `label`, `probability`, `kind`: open / won / lost); stage ids are unique across pipelines (a clash is a conflict, not applied); views `object` and `name` (matched by name; `type`, `columns`, `filters`, `sorts`, `groupBy`, `shared`). `-` reads the file from stdin.
- Full reference: https://github.com/fleox/agentcrm/blob/master/docs/schema-as-code.md

## Views

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 views list --site acme --object deals --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 views create --site acme --object deals --name "Closing this month" --filter closeDate:withinDays:30 --sort closeDate --columns name,amount,stage,closeDate --shared --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 views create --site acme --object deals --name Board --type kanban --group-by stage --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 views delete <viewId> --site acme --json
```

## Users and roles

Roles: `admin` (everything), `member` (records, activities, own views, import / export), `viewer` (read only).

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 users list --site acme --all --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 users add --site acme --email sam@acme.com --name "Sam Rivera" --role member --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 users role sam@acme.com admin --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 users disable sam@acme.com --site acme --json
```

Firebase / git-json sites: the login itself is created on that service (Firebase Authentication, a repository collaborator).

## Settings

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 settings get --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.12.0 settings set --site acme --set name="Acme CRM" --set defaultCurrency=EUR --set locale=fr-FR --set staleDealDays=21 --json
```

Secrets are refused in settings.
