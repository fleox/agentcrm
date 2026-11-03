// Setup wizard (mirror of cms-ia src/pages/SetupForm.tsx): Terms → Data
// model → Location / connection → Admin hosting → Workspace → Install.
// The "This browser" model is the quick path: Terms → Data → Workspace →
// Install. Logic lives in services/installers.ts.

import i18next from "i18next";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Cloud, Database, Download, ExternalLink, GitBranch, Loader2, Lock, Monitor, Rocket, XCircle } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Select } from "../../components/ui";
import { useAppControl } from "../../app/App";
import { setActiveLocale, SUPPORTED_LOCALES, LOCALE_LABELS, isSupportedLocale } from "../../i18n";
import { cn } from "../../shared/lib/utils";
import { downloadConfigJs } from "./services/adminDeploy";
import { install, type DataModel, type InstallResult } from "./services/installers";
import { describeLocation, dataLocation, hostingOption } from "./services/locations";
import { ChoiceCards, Note, RecommendedBadge, SectionTitle, Stepper } from "./components/SetupUi";
import { LocationStep, StepFooter } from "./steps/LocationStep";
import { HostingStep } from "./steps/HostingStep";
import { CURRENCIES, initialWizardState, setupErrorMessage, type WizardState } from "./steps/shared";

type StepId = "terms" | "data" | "location" | "hosting" | "workspace" | "install";

function stepsFor(model: DataModel): StepId[] {
  return model === "local" ? ["terms", "data", "workspace", "install"] : ["terms", "data", "location", "hosting", "workspace", "install"];
}

export function SetupWizard() {
  const { t, i18n } = useTranslation("setup");
  const [state, setState] = useState<WizardState>(initialWizardState);
  const [step, setStep] = useState<StepId>("terms");
  const update = useCallback((patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch })), []);
  const steps = stepsFor(state.model);
  const go = (delta: 1 | -1) => setStep((cur) => steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(cur) + delta))]);
  const props = { state, update, onBack: () => go(-1), onNext: () => go(1) };

  return (
    <div className="min-h-screen bg-surface-50 px-4 py-8 dark:bg-surface-950 sm:py-12">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-900 text-white dark:bg-white dark:text-surface-900">
              <Database className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-surface-900 dark:text-white">{t("wizard.title")}</h1>
              <p className="text-xs text-surface-500">{t("wizard.subtitle")}</p>
            </div>
          </div>
          <Select
            aria-label={t("wizard.language")}
            className="w-32"
            value={isSupportedLocale(i18n.language) ? i18n.language : "en"}
            onChange={(e) => setActiveLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
            options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
          />
        </header>
        <Stepper steps={steps.map((id) => ({ id, label: t(`wizard.steps.${id}`) }))} current={step} />
        <Card className="p-5 sm:p-6">
          {step === "terms" && (
            <TermsStep
              onNext={() => go(1)}
              onQuickStart={() => {
                update({ model: "local", existing: null, join: false, workspace: { ...state.workspace, demo: true } });
                setStep("workspace");
              }}
            />
          )}
          {step === "data" && <DataStep {...props} />}
          {step === "location" && <LocationStep {...props} />}
          {step === "hosting" && <HostingStep {...props} />}
          {step === "workspace" && <WorkspaceStep {...props} />}
          {step === "install" && <InstallStep {...props} />}
        </Card>
      </div>
    </div>
  );
}

// ─── Terms ───────────────────────────────────────────────────────────────

function TermsStep({ onNext, onQuickStart }: { onNext(): void; onQuickStart(): void }) {
  const { t } = useTranslation("setup");
  const [accepted, setAccepted] = useState(false);
  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (accepted) onNext();
      }}
    >
      <SectionTitle hint={t("terms.hint")}>{t("terms.title")}</SectionTitle>
      <ul className="space-y-2 text-sm text-surface-700 dark:text-surface-300">
        {(["static", "yourData", "secrets", "gdpr", "warranty"] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
            <span>{t(`terms.points.${k}`)}</span>
          </li>
        ))}
      </ul>
      <Checkbox label={t("terms.accept")} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-surface-300 p-3 dark:border-surface-700">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Monitor className="h-4 w-4 text-surface-500" /> {t("terms.quickTitle")}
          </p>
          <p className="text-xs text-surface-500">{t("terms.quickHint")}</p>
        </div>
        <Button size="sm" disabled={!accepted} onClick={onQuickStart}>
          {t("terms.quickStart")}
        </Button>
      </div>
      <StepFooter nextDisabled={!accepted} nextLabel={t("terms.start")} />
    </form>
  );
}

// ─── Data model ──────────────────────────────────────────────────────────

function DataStep({ state, update, onBack, onNext }: Parameters<typeof LocationStep>[0]) {
  const { t } = useTranslation("setup");
  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <SectionTitle hint={t("data.hint")}>{t("data.title")}</SectionTitle>
      <ChoiceCards<DataModel>
        columns={1}
        value={state.model}
        onChange={(model) => update({ model, existing: null, join: false })}
        choices={[
          { id: "journal", icon: <Lock />, title: t("data.models.journal.title"), description: t("data.models.journal.description"), badge: <RecommendedBadge /> },
          { id: "firebase", icon: <Cloud />, title: t("data.models.firebase.title"), description: t("data.models.firebase.description") },
          { id: "git-json", icon: <GitBranch />, title: t("data.models.git-json.title"), description: t("data.models.git-json.description") },
          { id: "local", icon: <Monitor />, title: t("data.models.local.title"), description: t("data.models.local.description") },
        ]}
      />
      <Note tone="info">{t(`data.models.${state.model}.details`)}</Note>
      <StepFooter onBack={onBack} />
    </form>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────

function WorkspaceStep({ state, update, onBack, onNext }: Parameters<typeof LocationStep>[0]) {
  const { t } = useTranslation("setup");
  const w = state.workspace;
  const set = (patch: Partial<WizardState["workspace"]>) => update({ workspace: { ...w, ...patch } });
  const joining = state.join && !!state.existing?.exists;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.adminEmail.trim());
  const needsEmail = state.model !== "local" || !!w.adminEmail.trim();
  const canContinue = (!needsEmail || emailOk) && (joining || !!w.adminName.trim() || state.model === "local");
  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canContinue) onNext();
      }}
    >
      <SectionTitle hint={joining ? t("workspace.joinHint") : t("workspace.hint")}>{joining ? t("workspace.joinTitle") : t("workspace.title")}</SectionTitle>
      {!joining && (
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <FormField label={t("workspace.name")} htmlFor="ws-name">
            <Input id="ws-name" value={w.name} placeholder="Acme CRM" autoComplete="off" onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField label={t("workspace.currency")} htmlFor="ws-currency">
            <Select id="ws-currency" value={w.currency} onChange={(e) => set({ currency: e.target.value })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </FormField>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("workspace.adminName")} htmlFor="ws-admin-name">
          <Input id="ws-admin-name" value={w.adminName} autoComplete="off" onChange={(e) => set({ adminName: e.target.value })} />
        </FormField>
        <FormField label={t("workspace.adminEmail")} htmlFor="ws-admin-email" help={state.model === "git-json" ? t("workspace.gitEmailHelp") : undefined}>
          <Input id="ws-admin-email" type="email" value={w.adminEmail} autoComplete="off" onChange={(e) => set({ adminEmail: e.target.value })} />
        </FormField>
      </div>
      {!joining && <Checkbox label={t("workspace.demo")} checked={w.demo} onChange={(e) => set({ demo: e.target.checked })} />}
      <StepFooter onBack={onBack} nextDisabled={!canContinue} />
    </form>
  );
}

// ─── Install ─────────────────────────────────────────────────────────────

type LogLine = { id: string; label: string; status: "running" | "done" | "error" };

function InstallStep({ state, onBack }: Parameters<typeof LocationStep>[0]) {
  const { t } = useTranslation("setup");
  const control = useAppControl();
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const joining = state.join && !!state.existing?.exists;

  const summary = useMemo(() => {
    const rows: [string, string][] = [[t("install.summary.model"), t(`data.models.${state.model}.title`)]];
    if (state.model === "journal") {
      const loc = dataLocation(state.journal.locationId);
      rows.push([t("install.summary.location"), `${describeLocation(loc.connectorId, { ...loc.preset, ...state.journal.settings })} / ${state.journal.root || "—"}`]);
      rows.push([t("install.summary.encryption"), state.journal.encrypted ? t("install.summary.encrypted") : t("install.summary.notEncrypted")]);
    }
    if (state.model === "git-json") {
      const g = state.git;
      rows.push([t("install.summary.location"), `${g.provider === "github" ? `${g.owner}/${g.repo}` : g.provider === "gitlab" ? g.project : t("location.gitLocal")} @ ${g.branch} / ${g.dir || "—"}`]);
    }
    if (state.model === "firebase") rows.push([t("install.summary.location"), state.firebase.projectId]);
    if (state.model !== "local") rows.push([t("install.summary.hosting"), t(`hosting.options.${hostingOption(state.hosting.optionId).id}.title`)]);
    rows.push([t("install.summary.mode"), joining ? t("install.summary.join") : state.workspace.demo ? t("install.summary.createDemo") : t("install.summary.create")]);
    if (state.workspace.adminEmail) rows.push([t("install.summary.admin"), `${state.workspace.adminName} <${state.workspace.adminEmail}>`]);
    return rows;
  }, [state, joining, t]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setLog([]);
    const progress = {
      step: (id: string, detail?: string) =>
        setLog((l) => {
          const label = `${t(`install.steps.${id}`)}${detail ? ` ${detail}` : ""}`;
          const i = l.findIndex((x) => x.id === id);
          if (i === -1) return [...l, { id, label, status: "running" }];
          const next = [...l];
          next[i] = { ...next[i], label, status: "running" };
          return next;
        }),
      done: (id: string) => setLog((l) => l.map((x) => (x.id === id ? { ...x, label: t(`install.steps.${id}`), status: "done" } : x))),
    };
    try {
      const res = await install(
        {
          model: state.model,
          journal: state.journal,
          git: state.git,
          firebase: state.firebase,
          hosting: state.hosting,
          workspace: { ...state.workspace, locale: i18next.language },
          join: joining,
        },
        progress,
      );
      setResult(res);
    } catch (err) {
      setLog((l) => l.map((x) => (x.status === "running" ? { ...x, status: "error" } : x)));
      setError(setupErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <div>
            <h2 className="text-base font-semibold">{t("install.doneTitle")}</h2>
            <p className="text-sm text-surface-500">{t("install.doneHint")}</p>
          </div>
        </div>
        {result.adminUrl && (
          <Note tone="success" title={t("install.adminDeployed")}>
            <a className="inline-flex items-center gap-1 font-medium underline" href={result.adminUrl} target="_blank" rel="noreferrer">
              {result.adminUrl} <ExternalLink className="h-3 w-3" />
            </a>
          </Note>
        )}
        {result.zipDownloaded && <Note tone="success">{t("install.zipDone")}</Note>}
        {result.runtime.backend !== "local" && !result.adminUrl && (
          <Note tone="info" title={t("install.configJsTitle")}>
            <p>{t("install.configJsBody")}</p>
            <Button size="sm" className="mt-2" icon={<Download />} onClick={() => downloadConfigJs(result.runtime)}>
              config.js
            </Button>
          </Note>
        )}
        <div className="flex justify-end">
          <Button variant="primary" icon={<Rocket />} onClick={() => control.reconfigure()}>
            {t("install.open")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void run();
      }}
    >
      <SectionTitle hint={t("install.hint")}>{t("install.title")}</SectionTitle>
      <dl className="divide-y divide-surface-100 rounded-lg border border-surface-200 text-sm dark:divide-surface-800 dark:border-surface-800">
        {summary.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-3 py-2">
            <dt className="w-36 shrink-0 text-surface-500">{k}</dt>
            <dd className="min-w-0 break-words font-medium text-surface-900 dark:text-surface-100">{v}</dd>
          </div>
        ))}
      </dl>
      {log.length > 0 && (
        <ul className="space-y-1.5 rounded-lg bg-surface-50 p-3 text-xs dark:bg-surface-950" aria-live="polite">
          {log.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <span className={cn("inline-flex [&>svg]:h-3.5 [&>svg]:w-3.5", l.status === "done" && "text-emerald-600", l.status === "error" && "text-red-600", l.status === "running" && "text-surface-500")}>
                <span className={cn("inline-flex", l.status !== "running" && "hidden")}>
                  <Loader2 className="animate-spin" />
                </span>
                <span className={cn("inline-flex", l.status !== "done" && "hidden")}>
                  <CheckCircle2 />
                </span>
                <span className={cn("inline-flex", l.status !== "error" && "hidden")}>
                  <XCircle />
                </span>
              </span>
              <span>{l.label}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <Note tone="danger" title={t("install.failed")}>{error}</Note>}
      <StepFooter onBack={busy ? undefined : onBack} busy={busy} nextLabel={error ? t("install.retry") : t("install.run")} nextIcon={<Rocket />} />
    </form>
  );
}
