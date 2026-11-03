// Sales goals — a useful AgentCRM extension module:
//   - monthly sales target per user (module configuration, set by admins on
//     Settings → Modules → Sales goals),
//   - dashboard widget: progress of each user vs. their won deals this month,
//   - AI tool `get_sales_goals`,
//   - automation action "Notify when the goal is reached" (adds a note on
//     the deal, once per user and month).
// Depends on the built-in "deals" module (manifest.json `dependsOn`).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, Target, Trophy } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Input,
  addBundles,
  defineModule,
  formatCurrency,
  intlLocale,
  ops,
  toast,
  useCan,
  useModuleConfig,
  useOps,
  usePipelines,
  useRecords,
  useSettings,
  useUsers,
  type AutomationActionDef,
} from "@agent-crm/runtime";
import { MODULE_ID, computeProgress, monthKey, progressFromOps, readConfig, type GoalProgress } from "./goals";

const en = {
  widget: { title: "Sales goals — {{month}}", empty: "No goal set yet.", setGoals: "Set goals", ofTarget: "{{won}} of {{target}}", deals_one: "{{count}} deal won", deals_other: "{{count}} deals won", noTarget: "no target" },
  settings: { intro: "Monthly target per user (won deal amount, {{currency}}). Progress counts deals in a “won” stage, by close date.", user: "User", target: "Monthly target", save: "Save goals", saved: "Goals saved." },
  action: { label: "Notify when the sales goal is reached", description: "Adds a note on the deal when its owner reaches their monthly goal (once per month).", message: "Note text" },
};
const fr = {
  widget: { title: "Objectifs de vente — {{month}}", empty: "Aucun objectif défini.", setGoals: "Définir les objectifs", ofTarget: "{{won}} sur {{target}}", deals_one: "{{count}} affaire gagnée", deals_other: "{{count}} affaires gagnées", noTarget: "pas d'objectif" },
  settings: { intro: "Objectif mensuel par utilisateur (montant des affaires gagnées, {{currency}}). La progression compte les affaires dans une étape « gagnée », par date de clôture.", user: "Utilisateur", target: "Objectif mensuel", save: "Enregistrer", saved: "Objectifs enregistrés." },
  action: { label: "Notifier quand l'objectif de vente est atteint", description: "Ajoute une note sur l'affaire quand son propriétaire atteint son objectif du mois (une fois par mois).", message: "Texte de la note" },
};
// The automation editor translates labels with the default namespace.
addBundles(MODULE_ID, { en, fr });

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(intlLocale(), { month: "long", year: "numeric" });
}

function GoalsWidget() {
  const { t } = useTranslation(MODULE_ID);
  const settings = useSettings();
  const deals = useRecords("deals");
  const pipelines = usePipelines("deals");
  const users = useUsers();
  const config = readConfig(useModuleConfig(MODULE_ID));
  const isAdmin = useCan("modules.write");
  const month = monthKey(Date.now());
  const rows = useMemo(() => computeProgress({ deals, pipelines, users, config, month }), [deals, pipelines, users, config, month]);
  const money = (n: number) => formatCurrency(n, settings.defaultCurrency, intlLocale(), true);
  return (
    <Card title={t("widget.title", { month: monthLabel(month) })} actions={isAdmin ? <a href="#/settings/modules/sales-goals" className="text-xs text-surface-500 hover:text-surface-900 dark:hover:text-white">{t("widget.setGoals")}</a> : undefined}>
      {rows.length === 0 ? (
        <EmptyState icon={<Target />} title={t("widget.empty")} />
      ) : (
        <ul className="space-y-3" data-testid="sales-goals">
          {rows.map((r) => (
            <GoalRow key={r.userId} row={r} money={money} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function GoalRow({ row, money }: { row: GoalProgress; money(n: number): string }) {
  const { t } = useTranslation(MODULE_ID);
  const pct = row.ratio === null ? 0 : Math.min(100, Math.round(row.ratio * 100));
  const reached = row.ratio !== null && row.ratio >= 1;
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-surface-900 dark:text-white">
          {reached && <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          {row.name}
        </span>
        <span className="shrink-0 tabular-nums text-surface-500">{row.target ? `${t("widget.ofTarget", { won: money(row.won), target: money(row.target) })} · ${Math.round((row.ratio ?? 0) * 100)}%` : `${money(row.won)} · ${t("widget.noTarget")}`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
        <div className={reached ? "h-full rounded-full bg-green-500" : "h-full rounded-full bg-accent-500"} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-2xs text-surface-400">{t("widget.deals", { count: row.dealsWon })}</div>
    </li>
  );
}

function GoalsSettings() {
  const { t } = useTranslation(MODULE_ID);
  const ctx = useOps();
  const settings = useSettings();
  const users = useUsers().filter((u) => u.role !== "viewer");
  const raw = useModuleConfig(MODULE_ID);
  const config = readConfig(raw);
  const canEdit = useCan("modules.write");
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(config.targets).map(([k, v]) => [k, String(v)])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const targets: Record<string, number> = {};
      for (const [k, v] of Object.entries(draft)) if (Number(v) > 0) targets[k] = Number(v);
      await ops.setModuleConfig(ctx, MODULE_ID, { ...config, targets });
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[13px] text-surface-500">{t("settings.intro", { currency: settings.defaultCurrency })}</p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-xs text-surface-500">
              <th className="pb-2 font-medium">{t("settings.user")}</th>
              <th className="w-48 pb-2 font-medium">{t("settings.target")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-surface-100 dark:border-surface-800">
                <td className="py-2">{u.name}</td>
                <td className="py-2">
                  <Input type="number" min={0} step={100} aria-label={`${t("settings.target")} — ${u.name}`} value={draft[u.id] ?? ""} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, [u.id]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" icon={<Save />} loading={busy}>
              {t("settings.save")}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

const notifyGoalReached: AutomationActionDef = {
  id: `${MODULE_ID}.notifyGoalReached`,
  label: `${MODULE_ID}:action.label`,
  description: `${MODULE_ID}:action.description`,
  objects: ["deals"],
  params: [{ id: "message", label: `${MODULE_ID}:action.message`, type: "text", template: true, placeholder: "{{owner}} reached the monthly sales goal!" }],
  describe: ({ record }) => `Note on "${String(record.fields.name ?? record.id)}" if its owner reached the monthly goal`,
  async run(ctx, { params, record }) {
    if (!record.ownerId) return "No owner — nothing to check.";
    const month = monthKey(ctx.now());
    const progress = progressFromOps(ctx, month).find((p) => p.userId === record.ownerId);
    if (!progress?.target) return "No goal set for the owner.";
    if ((progress.ratio ?? 0) < 1) return `Goal not reached yet (${Math.round((progress.ratio ?? 0) * 100)}%).`;
    const config = readConfig(ops.getModuleConfig(ctx, MODULE_ID));
    const key = `${record.ownerId}:${month}`;
    if (config.notified?.[key]) return "Already notified this month.";
    const text = typeof params.message === "string" && params.message.trim() ? params.message : `${progress.name} reached the monthly sales goal (${Math.round((progress.ratio ?? 0) * 100)}% of ${progress.target}).`;
    await ops.addNote(ctx, { object: record.object, id: record.id }, text, "Sales goal reached");
    await ops.setModuleConfig(ctx, MODULE_ID, { ...config, notified: { ...config.notified, [key]: ctx.now() } });
    return `Goal reached by ${progress.name}: note added.`;
  },
};

export default defineModule({
  id: MODULE_ID,
  apiVersion: "1.0.0",
  feature: {
    i18n: { en, fr },
    slots: { dashboardWidgets: [{ id: "sales-goals", order: 5, span: 6, component: GoalsWidget }] },
  },
  settingsPage: GoalsSettings,
  aiTools: [
    {
      name: "get_sales_goals",
      description: "Monthly sales goals per user (sales-goals extension): target, won deal amount, number of won deals and progress ratio for a month (default: the current one).",
      inputSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM (default: this month)." } } },
      mutating: false,
      handler: (ctx, input) => {
        const month = typeof input.month === "string" && /^\d{4}-\d{2}$/.test(input.month) ? input.month : monthKey(ctx.now());
        return { month, goals: progressFromOps(ctx, month).map((g) => ({ ...g, ratio: g.ratio === null ? null : Math.round(g.ratio * 1000) / 1000 })) };
      },
    },
  ],
  automationActions: [notifyGoalReached],
});
