# Module recipes

Every recipe is a fragment of `src/index.tsx` in a project made by `ext new module <id>`. They combine freely in one `defineModule({...})`. The module id (`ID` below) is also the i18n namespace (`t("<id>:key")`) and the module-config key.

```tsx
import { useTranslation } from "react-i18next";
import { FolderKanban } from "lucide-react";
import { defineModule, ops, type OpsContext, type ObjectDef } from "@agent-crm/runtime";

const ID = "acme-projects";
export default defineModule({
  id: ID,
  apiVersion: "1.0.0", // = manifest.json apiVersion
  feature: { routes: [], navItems: [], i18n: { en, fr }, slots: {} },
  settingsPage: SettingsPage,
  aiTools: [],
  automationActions: [],
  register(api) { /* hooks */ },
});
```

## 1. Custom object + its own page

Objects are data, not code: create them once (an AI tool or a settings-page button), never in `register()`. The admin then lists them in the navigation with table / kanban views like any object. Add a page of your own for a dedicated view.

```tsx
// Typed views of ops that are not in RuntimeOps' typed subset.
const createObject = ops.createObject as (ctx: OpsContext, input: {
  id?: string; labelSingular: string; labelPlural: string; icon?: string; color?: string;
  fields?: { id?: string; label: string; type: string; options?: string[]; relation?: { object: string; cardinality: "one" | "many" } }[];
}) => Promise<ObjectDef>;

async function ensureProjects(ctx: OpsContext): Promise<{ created: boolean }> {
  if (ops.listObjects(ctx).some((o) => o.id === "projects")) return { created: false };
  await createObject(ctx, {
    id: "projects", labelSingular: "Project", labelPlural: "Projects", icon: "FolderKanban", color: "violet",
    fields: [
      { id: "status", label: "Status", type: "select", options: ["Planned", "Active", "Done"] },
      { id: "client", label: "Client", type: "relation", relation: { object: "companies", cardinality: "one" } },
      { id: "budget", label: "Budget", type: "currency" },
    ],
  });
  return { created: true };
}

function ProjectsPage() {
  const { t } = useTranslation(ID);
  const projects = useRecords("projects");
  const project = useObject("projects");
  if (!project) return <EmptyState title={t("noObject")} description={t("noObjectHint")} />;
  return (
    <div>
      <PageHeader title={t("title")} icon={<FolderKanban />} actions={<Link to={paths.objectList("projects")}>{t("openTable")}</Link>} />
      <div className="grid gap-4 p-6 md:grid-cols-3">
        {["planned", "active", "done"].map((status) => (
          <Card key={status} title={t(`status.${status}`)}>
            {projects.filter((r) => r.fields.status === status).map((r) => (
              <Link key={r.id} to={paths.record("projects", r.id)} className="block py-1 text-sm">{recordLabel(project, r)}</Link>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

// feature:
//   routes: [{ path: "/acme-projects", element: <ProjectsPage /> }],
//   navItems: [{ id: ID, label: `${ID}:nav`, icon: FolderKanban, to: "/acme-projects", section: "workspace", order: 40 }],
// aiTools: [{ name: "acme_projects_setup", description: "Creates the Projects object (status, client, budget) if it is missing.",
//   inputSchema: { type: "object", properties: {} }, mutating: true, handler: (ctx) => ensureProjects(ctx) }],
```

- Select option ids are generated from the labels (`"Planned"` → `planned`); read `ops.listObjects(ctx)` for the exact ids.
- Creating objects needs an admin (`schema.write`). From the CLI: `agentcrm tools call acme_projects_setup --site <alias> --input '{}'`.
- Routes are paths of the admin's hash router (`#/acme-projects`). Use `paths.*` and `recordHref()` for links.

## 2. Record tab, panel and action

```tsx
function InvoicesTab({ record, object }: RecordSlotProps) {
  const { t } = useTranslation(ID);
  const activities = useActivities(record.id);
  return <div className="p-4 text-sm">{t("tabBody", { label: recordLabel(object, record), count: activities.length })}</div>;
}

// feature.slots:
//   recordDetailTabs: [{ id: "invoices", label: `${ID}:tab`, icon: Receipt, order: 60, component: InvoicesTab, when: (o) => o.id === "companies" }],
//   recordDetailPanels: [{ id: "health", order: 10, component: HealthPanel, when: (o) => o.id === "deals" }],
//   recordActions: [{ id: "sync", label: `${ID}:sync`, icon: RefreshCw, onSelect: ({ record }) => toast.info(record.id) }],
```

`when(object)` limits a slot to some objects. Labels are i18n keys (`<id>:key`) or plain text.

## 3. Dashboard widget

```tsx
function OpenDealsWidget() {
  const { t } = useTranslation(ID);
  const settings = useSettings();
  const deals = useRecords("deals");
  const enabled = useModuleEnabled("deals");
  if (!enabled) return null; // the deals module can be switched off
  const open = deals.filter((d) => !["won", "lost"].includes(String(d.fields.stage)));
  const total = open.reduce((n, d) => n + Number(d.fields.amount ?? 0), 0);
  return <Card title={t("widget")}><div className="text-2xl font-semibold tabular-nums">{formatCurrency(total, settings.defaultCurrency, intlLocale())}</div></Card>;
}
// feature.slots.dashboardWidgets: [{ id: "open-deals", order: 20, span: 4, component: OpenDealsWidget }]  // span 4 | 6 | 8 | 12
```

If the widget needs deals, declare `"dependsOn": ["deals"]` in `manifest.json`: the module can't be enabled while deals is off, and disabling deals asks to disable it too.

## 4. AI tool

```ts
aiTools: [{
  name: "acme_projects_at_risk",            // snake_case, prefixed, unique
  description: "Active projects whose budget is above 80 000 or that have no activity for 30 days. Use to answer questions about project risk.",
  inputSchema: { type: "object", properties: { days: { type: "number", description: "Inactivity threshold in days (default 30)." } } },
  mutating: false,                          // true when it writes: MCP read-only mode hides it, the CLI takes the site lock
  handler: (ctx, input) => {
    const days = typeof input.days === "number" ? input.days : 30;
    const page = ops.listRecords(ctx, "projects", { filters: [{ field: "status", op: "eq", value: "active" }], limit: 500 });
    return { projects: page.items.filter((r) => Number(r.fields.budget ?? 0) > 80000 || ctx.now() - r.updatedAt > days * 86400000).map((r) => ({ id: r.id, name: r.fields.name })) };
  },
}],
```

Return plain JSON (small: the model reads it). Throw an `Error` with a clear message on bad input. The tool is in `agentcrm tools list`, `agentcrm tools call`, the MCP server's `tools/list` and the in-admin assistant as soon as the module is enabled.

## 5. Automation action

```ts
const notifySlack: AutomationActionDef = {
  id: `${ID}.flagRisk`,                     // "<moduleId>.<action>"
  label: `${ID}:action.label`,
  description: `${ID}:action.description`,
  objects: ["projects"],                    // optional: only offered on these objects
  params: [{ id: "note", label: `${ID}:action.note`, type: "text", template: true, placeholder: "{{name}} is at risk" }],
  describe: ({ record }) => `Flag "${String(record.fields.name ?? record.id)}" as at risk`,
  validate: (params) => (typeof params.note === "string" && params.note.length > 500 ? ["The note is too long."] : []),
  async run(ctx, { params, record }) {
    await ops.addNote(ctx, { object: record.object, id: record.id }, String(params.note || "At risk"), "Risk flag");
    return "note added";                    // shown in the automation run log
  },
};
// defineModule({ automationActions: [notifySlack], … })
```

The automation editor lists it next to the built-in actions; stored as `{ type: "extension", action: "acme-projects.flagRisk", params }`. It runs wherever automations run: in the admin on each write, and in `agentcrm automations run` (scheduled / inactivity triggers) because the CLI loads enabled modules. If the module is disabled, runs fail with "not available" (nothing else breaks).

## 6. Settings page with module config

Module config is a JSON document per module (`config/modules.config.<id>`, at most 256 KB, never secrets), shared by all users, written by admins.

```tsx
interface Config { budgetAlert: number }
const readConfig = (raw: unknown): Config => ({ budgetAlert: Number((raw as Partial<Config> | undefined)?.budgetAlert ?? 80000) });

function SettingsPage() {
  const { t } = useTranslation(ID);
  const ctx = useOps();
  const canEdit = useCan("modules.write");
  const config = readConfig(useModuleConfig(ID));
  const [value, setValue] = useState(String(config.budgetAlert));
  return (
    <Card>
      <form data-form-type="other" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        await ops.setModuleConfig(ctx, ID, { ...config, budgetAlert: Number(value) });
        toast.success(t("saved"));
      }}>
        <FormField label={t("budgetAlert")}><Input type="number" value={value} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} /></FormField>
        {canEdit && <Button type="submit" variant="primary">{t("save")}</Button>}
      </form>
    </Card>
  );
}
// defineModule({ settingsPage: SettingsPage, … })  → Settings → Modules → <module> → /settings/modules/<id>
```

In AI tools / actions read it with `readConfig(ops.getModuleConfig(ctx, ID))`. From the CLI:

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.0 modules config get acme-projects --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.0 modules config set acme-projects --value '{"budgetAlert":50000}' --site acme --json
```

(the second prints a plan; add `--yes`).

## 7. Hooks on CRM actions

```ts
register(api) {
  api.addAction("stage.changed", async (ctx, { record, to }) => {
    if (record.object !== "deals" || to !== "won") return;
    await ops.createTask(ctx as OpsContext, { title: `Kick-off for ${String(record.fields.name)}`, dueAt: ctx.now() + 3 * 86400000, targets: [{ object: "deals", id: record.id }] });
  });
  api.addFilter("myModule.value", (v: number) => v * 2);
}
```

Actions: `record.created`, `record.updated` (`before`, `changed`), `record.deleted` (`hard`), `record.restored`, `stage.changed` (`pipelineId`, `from`, `to`), `activity.created`, `activity.updated`, `activity.completed`. The first argument is the context of the op that fired it (same user, same store). Everything registered through `api` is removed when the module is disabled or upgraded. A failing handler is logged and never blocks the write.

## 8. Strings (en + fr)

```ts
const en = { nav: "Projects", title: "Projects board", status: { planned: "Planned", active: "Active", done: "Done" } };
const fr: typeof en = { nav: "Projets", title: "Tableau des projets", status: { planned: "Prévu", active: "En cours", done: "Terminé" } };
// feature.i18n: { en, fr }   (or addBundles(ID, { en, fr }) at the top level)
```

`const { t } = useTranslation(ID)` in components; labels in nav items, slots and automation actions are keys like `` `${ID}:nav` ``.
