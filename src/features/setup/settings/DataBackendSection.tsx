// Settings → Data backend (admins): where the data lives, encryption
// (change passphrase / turn on / off through rekeyJournal), compaction,
// JSON export, transfer to another backend with ids preserved, and
// switching this browser to it.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, Cloud, Database, Download, Eraser, GitBranch, KeyRound, Lock, Monitor, ShieldCheck, Unlock } from "lucide-react";
import { Badge, Button, Card, FormField, Input, Modal, confirmDialog } from "../../../components/ui";
import { useAppControl } from "../../../app/App";
import { useAuth } from "../../../app/AuthContext";
import { useCrm } from "../../../app/CrmDataContext";
import { rekeyJournal } from "../../../data/journal/rekey";
import type { JournalDataStore } from "../../../data/journal";
import { getConnectorSecrets, getPassphrase, getRuntimeConfig, saveLocalRuntimeConfig, setPassphrase, type RuntimeConfig } from "../../../lib/runtimeConfig";
import { compactData } from "../../../ops/compact";
import { exportJson } from "../../../ops/exportCsv";
import { buildFirestoreRules, type FirebaseSignup } from "../../../ops/firebaseRules";
import { instantiateStorageConnector } from "../../../shared/storage/registry";
import { toast } from "../../../shared/lib/toast";
import { downloadText, uploadConfigJs } from "../services/adminDeploy";
import { openTargetStore, type InstallPlan } from "../services/installers";
import { describeLocation, hostingOptionFor } from "../services/locations";
import { passphraseAcceptable } from "../services/passphrase";
import { transferData } from "../services/transfer";
import { ChoiceCards, CopyBlock, Note, PassphraseFields, SectionTitle } from "../components/SetupUi";
import { LocationStep } from "../steps/LocationStep";
import { initialWizardState, setupErrorMessage, type WizardState } from "../steps/shared";
import type { DataModel } from "../services/installers";

function locationLabel(config: RuntimeConfig, t: (k: string) => string): string {
  switch (config.backend) {
    case "journal":
      return `${describeLocation(config.journal.connectorId, config.journal.settings, t("access.journal.localFolder"))} / ${config.journal.root || "—"}`;
    case "git-json": {
      const g = config.git;
      const repo = g.provider === "github" ? `${g.owner}/${g.repo}` : g.provider === "gitlab" ? g.project : t("location.gitLocal");
      return `${repo} @ ${g.branch} / ${g.dir || "—"}`;
    }
    case "firebase":
      return config.firebase.projectId ?? "";
    default:
      return t("data.models.local.title");
  }
}

export function DataBackendSection() {
  const { t } = useTranslation("setup");
  const { store, ops } = useCrm();
  const config = getRuntimeConfig();
  const [stats, setStats] = useState<Awaited<ReturnType<JournalDataStore["stats"]>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rekeyOpen, setRekeyOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  useEffect(() => {
    const s = store as Partial<JournalDataStore>;
    if (store.kind === "journal" && s.stats) void s.stats().then(setStats).catch(() => setStats(null));
  }, [store, busy]);

  if (!config) return null;
  const encrypted = config.backend === "journal" ? config.journal.encrypted : null;

  const compact = async () => {
    if (!(await confirmDialog({ title: t("settings.data.compactConfirmTitle"), description: t("settings.data.compactConfirmBody"), confirmLabel: t("settings.data.compact") }))) return;
    setBusy("compact");
    try {
      const r = await compactData(ops);
      toast.success(t("settings.data.compactDone", { records: r.purgedRecords.length, activities: r.purgedActivities }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportAll = () => {
    const data = exportJson(ops);
    downloadText(JSON.stringify(data, null, 2) + "\n", `agentcrm-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  };

  return (
    <div className="max-w-3xl space-y-5">
      <Card title={t("settings.data.title")}>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-surface-500">{t("settings.data.backend")}</dt>
          <dd className="flex items-center gap-2 font-medium">
            <Database className="h-4 w-4 text-surface-500" /> {t(`data.models.${config.backend}.title`)}
          </dd>
          <dt className="text-surface-500">{t("settings.data.location")}</dt>
          <dd className="break-all font-mono text-xs">{locationLabel(config, t)}</dd>
          {encrypted !== null && (
            <>
              <dt className="text-surface-500">{t("settings.data.encryption")}</dt>
              <dd>
                <Badge color={encrypted ? "green" : "orange"} dot>
                  {encrypted ? t("install.summary.encrypted") : t("install.summary.notEncrypted")}
                </Badge>
              </dd>
            </>
          )}
          {stats && (
            <>
              <dt className="text-surface-500">{t("settings.data.storage")}</dt>
              <dd className="text-xs text-surface-600 dark:text-surface-300">{t("settings.data.stats", { ...stats })}</dd>
            </>
          )}
        </dl>
        {config.backend === "git-json" && <Note tone="warning" className="mt-4">{t("location.gitHistoryBody")}</Note>}
      </Card>

      {config.backend === "journal" && (
        <Card title={t("settings.data.encryptionTitle")}>
          <p className="mb-3 text-sm text-surface-500">{t(encrypted ? "settings.data.encryptionOnHint" : "settings.data.encryptionOffHint")}</p>
          <Button icon={encrypted ? <KeyRound /> : <Lock />} onClick={() => setRekeyOpen(true)}>
            {encrypted ? t("settings.data.changePassphrase") : t("settings.data.enableEncryption")}
          </Button>
          <RekeyModal open={rekeyOpen} onClose={() => setRekeyOpen(false)} config={config} />
        </Card>
      )}

      <Card title={t("settings.data.maintenanceTitle")}>
        <div className="space-y-4">
          <Row title={t("settings.data.compact")} hint={t(config.backend === "journal" ? "settings.data.compactHintJournal" : "settings.data.compactHint")}>
            <Button icon={<Eraser />} loading={busy === "compact"} onClick={() => void compact()}>
              {t("settings.data.compactNow")}
            </Button>
          </Row>
          <Row title={t("settings.data.export")} hint={t("settings.data.exportHint")}>
            <Button icon={<Download />} onClick={exportAll}>
              {t("settings.data.exportJson")}
            </Button>
          </Row>
          <Row title={t("settings.data.transfer")} hint={t("settings.data.transferHint")}>
            <Button icon={<ArrowRightLeft />} onClick={() => setTransferOpen(true)}>
              {t("settings.data.transferStart")}
            </Button>
          </Row>
        </div>
        <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} />
      </Card>

      {config.backend === "firebase" && <FirebaseRulesCard />}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 max-w-lg">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-surface-500">{hint}</p>
      </div>
      {children}
    </div>
  );
}

// ─── Encryption ──────────────────────────────────────────────────────────

function RekeyModal({ open, onClose, config }: { open: boolean; onClose(): void; config: RuntimeConfig }) {
  const { t } = useTranslation("setup");
  const control = useAppControl();
  const encrypted = config.backend === "journal" && config.journal.encrypted;
  const [current, setCurrent] = useState(getPassphrase(config) ?? "");
  const [next, setNext] = useState({ passphrase: "", confirm: "" });
  const [disable, setDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (config.backend !== "journal") return null;
  const valid = (!encrypted || !!current.trim()) && (disable || (passphraseAcceptable(next.passphrase) && next.passphrase === next.confirm));

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = config.journal;
      const connector = instantiateStorageConnector(j.connectorId, { ...j.settings, ...getConnectorSecrets(config) });
      const newPass = disable ? null : next.passphrase;
      await rekeyJournal({ connector, root: j.root, oldPassphrase: encrypted ? current : null, newPassphrase: newPass });
      const updated: RuntimeConfig = { ...config, journal: { ...j, encrypted: !!newPass } };
      setPassphrase(updated, newPass);
      if (updated.journal.encrypted !== j.encrypted) saveLocalRuntimeConfig(updated);
      toast.success(t(newPass ? "settings.data.rekeyDone" : "settings.data.decryptDone"));
      onClose();
      control.reconfigure();
    } catch (err) {
      setError((err as Error).name === "PassphraseError" ? t("errors.wrongPassphrase") : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={encrypted ? t("settings.data.changePassphrase") : t("settings.data.enableEncryption")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant={disable ? "danger" : "primary"} icon={disable ? <Unlock /> : <KeyRound />} loading={busy} disabled={!valid} onClick={() => void run()}>
            {disable ? t("settings.data.disableEncryption") : t("settings.data.applyPassphrase")}
          </Button>
        </>
      }
    >
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) void run();
        }}
      >
        <Note tone="warning">{t("settings.data.rekeyWarning")}</Note>
        {encrypted && (
          <FormField label={t("settings.data.currentPassphrase")} htmlFor="rk-current">
            <Input id="rk-current" type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </FormField>
        )}
        {!disable && <PassphraseFields idPrefix="rk" passphrase={next.passphrase} confirm={next.confirm} onChange={setNext} />}
        {encrypted && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={disable} onChange={(e) => setDisable(e.target.checked)} />
            {t("settings.data.disableEncryptionCheck")}
          </label>
        )}
        {disable && <Note tone="danger">{t("passphrase.plainWarning")}</Note>}
        {!disable && <Note tone="danger" title={t("passphrase.lostTitle")}>{t("passphrase.lostBody")}</Note>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

// ─── Transfer ────────────────────────────────────────────────────────────

function TransferModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation("setup");
  const { store, user } = useCrm();
  const control = useAppControl();
  const [state, setState] = useState<WizardState>(() => ({ ...initialWizardState(), workspace: { ...initialWizardState().workspace, adminEmail: user.email, adminName: user.name } }));
  const [phase, setPhase] = useState<"model" | "location" | "confirm" | "done">("model");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<RuntimeConfig | null>(null);
  const [report, setReport] = useState<{ written: number } | null>(null);
  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const reset = () => {
    setPhase("model");
    setError(null);
    setReport(null);
    setTarget(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const plan: InstallPlan = { model: state.model, journal: state.journal, git: state.git, firebase: state.firebase, hosting: { optionId: "none", settings: {}, folder: "" }, workspace: state.workspace, join: false };
      const { runtime, store: dest } = await openTargetStore(plan);
      try {
        const res = await transferData(store, dest, { user });
        setReport(res);
        setTarget({ ...runtime, ...(getRuntimeConfig()?.name ? { name: getRuntimeConfig()!.name } : {}) } as RuntimeConfig);
        setPhase("done");
      } finally {
        dest.close?.();
      }
    } catch (err) {
      setError(setupErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async () => {
    if (!target) return;
    saveLocalRuntimeConfig(target);
    const hosting = store.get("config", "hosting") as { connectorId?: string; settings?: Record<string, unknown>; folder?: string } | undefined;
    if (hosting?.connectorId && hostingOptionFor(hosting.connectorId, hosting.settings ?? {}).id !== "zip") {
      try {
        const { getHostingSecrets } = await import("../../../lib/runtimeConfig");
        const current = getRuntimeConfig();
        await uploadConfigJs({ connectorId: hosting.connectorId, settings: { ...(hosting.settings ?? {}), ...(current ? getHostingSecrets(current) : {}) } }, hosting.folder ?? "admin", target);
        toast.success(t("settings.data.configJsUpdated"));
      } catch (err) {
        toast.error(t("settings.data.configJsFailed", { detail: (err as Error).message }));
      }
    }
    onClose();
    control.reconfigure();
  };

  const models: { id: DataModel; icon: JSX.Element }[] = [
    { id: "journal", icon: <Lock /> },
    { id: "firebase", icon: <Cloud /> },
    { id: "git-json", icon: <GitBranch /> },
    { id: "local", icon: <Monitor /> },
  ];

  return (
    <Modal open={open} onClose={() => !busy && (onClose(), reset())} dismissible={false} size="lg" title={t("settings.data.transfer")} description={t("settings.data.transferHint")}>
      {phase === "model" && (
        <form
          data-form-type="other"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPhase(state.model === "local" ? "confirm" : "location");
          }}
        >
          <ChoiceCards<DataModel>
            value={state.model}
            onChange={(model) => update({ model, existing: null, join: false })}
            choices={models.map((m) => ({ id: m.id, icon: m.icon, title: t(`data.models.${m.id}.title`), description: t(`data.models.${m.id}.description`) }))}
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("common.continue")}
            </Button>
          </div>
        </form>
      )}
      {phase === "location" && <LocationStep state={state} update={update} onBack={() => setPhase("model")} onNext={() => setPhase("confirm")} />}
      {phase === "confirm" && (
        <form
          data-form-type="other"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void run();
          }}
        >
          {state.existing?.exists && <Note tone="danger">{t("settings.data.transferNotEmpty")}</Note>}
          <Note tone="info">{t("settings.data.transferExplain")}</Note>
          {state.model === "firebase" && <Note tone="warning">{t("settings.data.transferFirebaseUsers")}</Note>}
          {error && <Note tone="danger">{error}</Note>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setPhase(state.model === "local" ? "model" : "location")} disabled={busy}>
              {t("common.back")}
            </Button>
            <Button type="submit" variant="primary" icon={<ArrowRightLeft />} loading={busy} disabled={!!state.existing?.exists}>
              {t("settings.data.transferRun")}
            </Button>
          </div>
        </form>
      )}
      {phase === "done" && report && (
        <div className="space-y-4">
          <Note tone="success" title={t("settings.data.transferDone", { count: report.written })}>
            {t("settings.data.transferDoneHint")}
          </Note>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (onClose(), reset())}>
              {t("settings.data.stayHere")}
            </Button>
            <Button variant="primary" icon={<ArrowRightLeft />} onClick={() => void switchTo()}>
              {t("settings.data.switchNow")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Firebase rules ──────────────────────────────────────────────────────

function FirebaseRulesCard() {
  const { t } = useTranslation("setup");
  const { identity } = useAuth();
  const [email, setEmail] = useState(identity.email);
  const [signup, setSignup] = useState<FirebaseSignup>("invite");
  const [domains, setDomains] = useState("");
  let rules: string | null = null;
  try {
    rules = buildFirestoreRules({ adminEmail: email, signup, allowedDomains: domains.split(/[\s,]+/).filter(Boolean) });
  } catch {
    rules = null;
  }
  return (
    <Card title={t("settings.data.rulesTitle")}>
      <div className="space-y-3">
        <SectionTitle hint={t("settings.data.rulesHint")}>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" /> firestore.rules
          </span>
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("fields.adminEmail")} htmlFor="rules-email">
            <Input id="rules-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label={t("location.signup")} htmlFor="rules-signup">
            <select id="rules-signup" className="h-8 w-full rounded-md border border-surface-200 bg-white px-2 text-sm dark:border-surface-700 dark:bg-surface-900" value={signup} onChange={(e) => setSignup(e.target.value as FirebaseSignup)}>
              {(["invite", "domain", "open"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`location.signupModes.${v}`)}
                </option>
              ))}
            </select>
          </FormField>
          {signup === "domain" && (
            <FormField label={t("location.allowedDomains")} htmlFor="rules-domains">
              <Input id="rules-domains" value={domains} onChange={(e) => setDomains(e.target.value)} />
            </FormField>
          )}
        </div>
        {rules ? (
          <>
            <CopyBlock text={rules} />
            <Button size="sm" icon={<Download />} onClick={() => downloadText(rules!, "firestore.rules")}>
              firestore.rules
            </Button>
          </>
        ) : (
          <p className="text-xs text-surface-500">{t("location.rulesNeedEmail")}</p>
        )}
      </div>
    </Card>
  );
}
