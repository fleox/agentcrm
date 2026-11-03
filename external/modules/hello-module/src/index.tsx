// Hello module — the minimal AgentCRM extension:
//   - a page at /hello with a navigation entry,
//   - a "Hello" tab on every record page,
//   - an AI tool `hello_world` (MCP, in-admin assistant, `agentcrm tools`).
// Everything comes from `@agent-crm/runtime` (the admin's own instances).
import { Smile } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card, PageHeader, defineModule, formatDateTime, intlLocale, ops, recordLabel, toast, useCurrentUser, useObjects, useRecords, type RecordSlotProps } from "@agent-crm/runtime";

const ID = "hello-module";

const en = {
  nav: "Hello",
  title: "Hello from an extension",
  greeting: "Hi {{name}}! This page is served by the {{id}} extension.",
  counts: "Records in this workspace",
  wave: "Wave",
  waved: "Hello!",
  tab: "Hello",
  tabBody: "Hello from “{{label}}”, created {{date}}.",
};
const fr = {
  nav: "Bonjour",
  title: "Bonjour depuis une extension",
  greeting: "Salut {{name}} ! Cette page est servie par l'extension {{id}}.",
  counts: "Fiches de cet espace",
  wave: "Saluer",
  waved: "Bonjour !",
  tab: "Bonjour",
  tabBody: "Bonjour depuis « {{label}} », créée le {{date}}.",
};

function HelloPage() {
  const { t } = useTranslation(ID);
  const me = useCurrentUser();
  const objects = useObjects();
  const records = useRecords(undefined);
  return (
    <div>
      <PageHeader title={t("title")} icon={<Smile />} />
      <div className="space-y-4 p-6">
        <p className="text-sm text-surface-600 dark:text-surface-300">{t("greeting", { name: me.name, id: ID })}</p>
        <Card title={t("counts")}>
          <ul className="space-y-1 text-sm">
            {objects.map((o) => (
              <li key={o.id} className="flex justify-between">
                <span>{o.labelPlural}</span>
                <span className="tabular-nums text-surface-500">{records.filter((r) => r.object === o.id).length}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Button variant="primary" icon={<Smile />} onClick={() => toast.success(t("waved"))}>
          {t("wave")}
        </Button>
      </div>
    </div>
  );
}

function HelloTab({ record, object }: RecordSlotProps) {
  const { t } = useTranslation(ID);
  return <p className="p-4 text-sm text-surface-600 dark:text-surface-300">{t("tabBody", { label: recordLabel(object, record), date: formatDateTime(record.createdAt, intlLocale()) })}</p>;
}

export default defineModule({
  id: ID,
  apiVersion: "1.0.0",
  feature: {
    routes: [{ path: "/hello", element: <HelloPage /> }],
    navItems: [{ id: "hello", label: `${ID}:nav`, icon: Smile, to: "/hello", section: "workspace", order: 50 }],
    i18n: { en, fr },
    slots: { recordDetailTabs: [{ id: "hello", label: `${ID}:tab`, icon: Smile, order: 80, component: HelloTab }] },
  },
  aiTools: [
    {
      name: "hello_world",
      description: "Example tool of the hello-module extension: greets someone and returns how many records each object holds.",
      inputSchema: { type: "object", properties: { name: { type: "string", description: "Who to greet." } } },
      mutating: false,
      handler: (ctx, input) => {
        const counts = Object.fromEntries(ops.listObjects(ctx).map((o) => [o.id, ops.listRecords(ctx, o.id, { limit: 1 }).total]));
        return { greeting: `Hello ${typeof input.name === "string" && input.name ? input.name : ctx.user?.name ?? "there"}!`, counts };
      },
    },
  ],
});
