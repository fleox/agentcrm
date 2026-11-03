// Step "Location / connection": where the data lives for the chosen
// model, verified by a side-effect-free test that also detects an
// existing dataset (join vs create).

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Download, FolderOpen, GitBranch, Github, Gitlab, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Button, Checkbox, FormField, Input, Select, Textarea } from "../../../components/ui";
import { buildFirebaseJson, buildFirestoreIndexes, buildFirestoreRules, type FirebaseSignup } from "../../../ops/firebaseRules";
import { cn } from "../../../shared/lib/utils";
import { downloadText } from "../services/adminDeploy";
import {
  checkExistingPassphrase,
  parseFirebaseSnippet,
  testGitRepo,
  testJournalLocation,
  verifyFirebaseSetup,
  type FirebaseInput,
  type GitInput,
} from "../services/installers";
import { DATA_FIELDS, DATA_LOCATIONS, dataLocation, missingRequired, S3_PRESETS, s3Preset, type DataLocationId } from "../services/locations";
import { passphraseAcceptable } from "../services/passphrase";
import { ChoiceCards, ConnectorFields, CopyBlock, EncryptionToggle, FolderPicker, Note, PassphraseFields, RecommendedBadge, SecretInput, SectionTitle, TestButton, TestStatus, type TestState } from "../components/SetupUi";
import { setupErrorMessage, type Patch, type WizardState } from "./shared";

export interface StepProps {
  state: WizardState;
  update: Patch<WizardState>;
  onBack(): void;
  onNext(): void;
}

// The primary button submits the step's <form> (its onSubmit runs the
// step action) — never an onClick too, or the action would run twice.
export function StepFooter({ onBack, nextLabel, nextDisabled, busy, nextIcon }: { onBack?: () => void; nextLabel?: string; nextDisabled?: boolean; busy?: boolean; nextIcon?: ReactNode }) {
  const { t } = useTranslation("setup");
  return (
    <div className="flex items-center justify-between gap-3 border-t border-surface-100 pt-4 dark:border-surface-800">
      {onBack ? (
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {t("common.back")}
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" variant="primary" disabled={nextDisabled} loading={busy} icon={nextIcon}>
        {nextLabel ?? t("common.continue")}
      </Button>
    </div>
  );
}

export function LocationStep(props: StepProps) {
  if (props.state.model === "firebase") return <FirebaseConnection {...props} />;
  if (props.state.model === "git-json") return <GitConnection {...props} />;
  return <JournalLocation {...props} />;
}

// ─── Journal: encrypted file on my storage ───────────────────────────────

const LOCATION_ICONS: Record<DataLocationId, JSX.Element> = { s3: <Cloud />, github: <Github />, gitlab: <Gitlab />, "local-folder": <FolderOpen /> };

function JournalLocation({ state, update, onBack, onNext }: StepProps) {
  const { t } = useTranslation("setup");
  const j = state.journal;
  const loc = dataLocation(j.locationId);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const setJ = (patch: Partial<WizardState["journal"]>, keepTest = false) => {
    update({ journal: { ...j, ...patch }, ...(keepTest ? {} : { existing: null, join: false }) });
    if (!keepTest) setTest({ status: "idle" });
  };
  const settings = { ...loc.preset, ...j.settings };
  const missing = missingRequired(DATA_FIELDS[loc.id], settings);
  const existing = state.existing;
  const joining = !!existing?.exists && state.join;
  const encrypted = joining ? !!existing?.encrypted : j.encrypted;
  const passOk = !encrypted || (joining ? !!j.passphrase.trim() : passphraseAcceptable(j.passphrase) && j.passphrase === j.confirm);
  const tested = test.status === "ok";
  const canContinue = tested && (!existing?.exists || state.join) && passOk && (loc.id !== "local-folder" || !!j.folderName);

  const runTest = async () => {
    setTest({ status: "running" });
    try {
      const res = await testJournalLocation(j);
      update({ existing: res.existing, join: res.existing.exists });
      setTest({
        status: "ok",
        detail: (
          <>
            {t("location.testOk", { detail: res.detail })}
            {res.publicRepo && <span className="mt-1 block text-amber-700 dark:text-amber-400">{t("location.publicRepoEncrypted")}</span>}
          </>
        ),
      });
    } catch (err) {
      setTest({ status: "error", detail: setupErrorMessage(t, err) });
    }
  };

  const next = async () => {
    if (joining && encrypted) {
      setBusy(true);
      try {
        if (!(await checkExistingPassphrase(j))) {
          setTest({ status: "error", detail: t("errors.wrongPassphrase") });
          return;
        }
      } catch (err) {
        setTest({ status: "error", detail: setupErrorMessage(t, err) });
        return;
      } finally {
        setBusy(false);
      }
    }
    if (joining) setJ({ encrypted }, true);
    onNext();
  };

  const preset = s3Preset(String(settings.s3Preset ?? "r2"));

  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canContinue) void next();
      }}
    >
      <SectionTitle hint={t("location.journalHint")}>{t("location.journalTitle")}</SectionTitle>
      <ChoiceCards
        columns={2}
        value={j.locationId}
        onChange={(id) => setJ({ locationId: id, settings: id === "s3" ? { ...s3Preset("r2").settings, s3Preset: "r2" } : { ...dataLocation(id).preset }, folderName: null })}
        choices={DATA_LOCATIONS.map((l) => ({
          id: l.id,
          icon: LOCATION_ICONS[l.id],
          title: t(`location.options.${l.id}.title`),
          description: t(`location.options.${l.id}.description`),
          badge: l.id === "s3" ? <RecommendedBadge /> : undefined,
        }))}
      />

      {loc.id === "s3" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-surface-600 dark:text-surface-300">{t("location.provider")}</p>
          <div className="flex flex-wrap gap-1.5">
            {S3_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setJ({ settings: { ...j.settings, ...p.settings, s3Preset: p.id } })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  preset.id === p.id ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300" : "border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300",
                )}
              >
                {t(`location.s3Presets.${p.id}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-surface-500">{t(`location.s3PresetHints.${preset.id}`)}</p>
        </div>
      )}

      {loc.id === "local-folder" ? (
        <div className="space-y-2">
          <FolderPicker handleKey="data-folder" picked={j.folderName} onPicked={(name) => setJ({ folderName: name })} />
          <p className="text-xs text-surface-500">{t("location.localFolderHint")}</p>
        </div>
      ) : (
        <ConnectorFields
          idPrefix="loc"
          fields={DATA_FIELDS[loc.id]}
          value={settings}
          onChange={(next) => setJ({ settings: next })}
          placeholders={loc.id === "s3" ? { endpoint: preset.endpointPlaceholder, region: preset.regionPlaceholder } : {}}
        />
      )}

      <FormField label={t("location.root")} htmlFor="loc-root" help={t("location.rootHelp")}>
        <Input id="loc-root" value={j.root} autoComplete="off" onChange={(e) => setJ({ root: e.target.value })} placeholder="agentcrm" />
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <TestButton running={test.status === "running"} onClick={() => void runTest()} />
        {missing.length > 0 && <span className="text-xs text-surface-500">{t("location.fillRequired")}</span>}
      </div>
      <TestStatus state={test} />

      {existing?.exists && (
        <Note tone="info" title={t("location.existingTitle")}>
          <p>{t(existing.encrypted ? "location.existingEncrypted" : "location.existingPlain")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant={state.join ? "primary" : "outline"} onClick={() => update({ join: true })}>
              {t("location.joinExisting")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setJ({ root: `${j.root || "agentcrm"}-2` })}>
              {t("location.useAnotherFolder")}
            </Button>
          </div>
        </Note>
      )}

      <div className="space-y-3">
        {!joining && <EncryptionToggle enabled={j.encrypted} onChange={(v) => setJ({ encrypted: v }, true)} />}
        {encrypted && (
          <>
            {joining ? (
              <FormField label={t("passphrase.existingLabel")} htmlFor="loc-pass" help={t("passphrase.existingHelp")}>
                <SecretInput id="loc-pass" value={j.passphrase} onChange={(v) => setJ({ passphrase: v }, true)} />
              </FormField>
            ) : (
              <PassphraseFields idPrefix="loc" passphrase={j.passphrase} confirm={j.confirm} onChange={(v) => setJ(v, true)} />
            )}
            <Note tone="danger" title={t("passphrase.lostTitle")}>
              {t("passphrase.lostBody")}
            </Note>
          </>
        )}
        {!encrypted && !joining && <Note tone="warning">{t("passphrase.plainWarning")}</Note>}
      </div>

      <StepFooter onBack={onBack} nextDisabled={!canContinue} busy={busy} />
    </form>
  );
}

// ─── Private git repository (git-json) ───────────────────────────────────

function GitConnection({ state, update, onBack, onNext }: StepProps) {
  const { t } = useTranslation("setup");
  const g = state.git;
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const setG = (patch: Partial<WizardState["git"]>) => {
    update({ git: { ...g, ...patch }, existing: null, join: false });
    setTest({ status: "idle" });
  };
  const [role, setRole] = useState<string | null>(null);

  const runTest = async () => {
    setTest({ status: "running" });
    try {
      const res = await testGitRepo(g as GitInput);
      if (res.publicRepo) {
        setTest({ status: "error", detail: t("errors.publicRepo") });
        return;
      }
      if (res.role === "viewer" && !res.existing.exists) {
        setTest({ status: "error", detail: t("errors.readOnly", { detail: res.login }) });
        return;
      }
      setRole(res.role);
      update({ existing: res.existing, join: res.existing.exists });
      setTest({ status: "ok", detail: t("location.gitOk", { login: res.login, role: t(`roles.${res.role}`) }) });
    } catch (err) {
      setTest({ status: "error", detail: setupErrorMessage(t, err) });
    }
  };

  const existing = state.existing;
  const canContinue = test.status === "ok" && (!existing?.exists || state.join);
  const repoFields = g.provider === "github" ? DATA_FIELDS.github : g.provider === "gitlab" ? DATA_FIELDS.gitlab : [];

  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canContinue) onNext();
      }}
    >
      <SectionTitle hint={t("location.gitHint")}>{t("location.gitTitle")}</SectionTitle>
      <ChoiceCards
        columns={3}
        value={g.provider}
        onChange={(provider) => setG({ provider, folderName: null })}
        choices={[
          { id: "github", icon: <Github />, title: "GitHub", description: t("location.gitGithub") },
          { id: "gitlab", icon: <Gitlab />, title: "GitLab", description: t("location.gitGitlab") },
          { id: "local", icon: <GitBranch />, title: t("location.gitLocal"), description: t("location.gitLocalHint") },
        ]}
      />
      {g.provider === "local" ? (
        <FolderPicker handleKey="git-json-folder" picked={g.folderName} onPicked={(name) => setG({ folderName: name })} />
      ) : (
        <ConnectorFields idPrefix="git" fields={repoFields} value={g as unknown as Record<string, unknown>} onChange={(next) => setG(next as Partial<WizardState["git"]>)} />
      )}
      <FormField label={t("location.gitDir")} htmlFor="git-dir" help={t("location.gitDirHelp")}>
        <Input id="git-dir" value={g.dir} autoComplete="off" onChange={(e) => setG({ dir: e.target.value })} placeholder="crm" />
      </FormField>
      <Note tone="warning" title={t("location.gitHistoryTitle")}>
        {t("location.gitHistoryBody")}
      </Note>
      <div className="flex items-center gap-3">
        <TestButton running={test.status === "running"} onClick={() => void runTest()} />
      </div>
      <TestStatus state={test} />
      {role && <p className="text-xs text-surface-500">{t("location.gitRoles")}</p>}
      {existing?.exists && (
        <Note tone="info" title={t("location.existingTitle")}>
          {t("location.existingGit", { count: existing.documents ?? 0, name: existing.name ?? "AgentCRM" })}
        </Note>
      )}
      <StepFooter onBack={onBack} nextDisabled={!canContinue} />
    </form>
  );
}

// ─── Firebase ────────────────────────────────────────────────────────────

const FIREBASE_KEYS: (keyof FirebaseInput)[] = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];

function FirebaseConnection({ state, update, onBack, onNext }: StepProps) {
  const { t } = useTranslation("setup");
  const f = state.firebase;
  const [snippet, setSnippet] = useState("");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const setF = (patch: Partial<FirebaseInput>) => {
    update({ firebase: { ...f, ...patch }, existing: null, join: false });
    setTest({ status: "idle" });
  };
  const rules = useMemo(() => {
    try {
      return f.adminEmail.includes("@")
        ? buildFirestoreRules({ adminEmail: f.adminEmail, signup: f.signup, allowedDomains: f.allowedDomains.split(/[\s,]+/).filter(Boolean) })
        : null;
    } catch {
      return null;
    }
  }, [f.adminEmail, f.signup, f.allowedDomains]);

  const verify = async () => {
    setTest({ status: "running" });
    try {
      const res = await verifyFirebaseSetup(f);
      update({
        existing: res.existing,
        join: res.existing.exists,
        workspace: { ...state.workspace, adminEmail: state.workspace.adminEmail || f.adminEmail.trim().toLowerCase() },
      });
      setTest({ status: "ok", detail: t("location.firebaseOk", { email: res.identity.email, role: t(`roles.${res.identity.role}`) }) });
      return true;
    } catch (err) {
      setTest({ status: "error", detail: setupErrorMessage(t, err) });
      return false;
    }
  };

  const toggleMethod = (m: "password" | "google", on: boolean) =>
    setF({ signInMethods: on ? [...new Set([...f.signInMethods, m])] : f.signInMethods.filter((x) => x !== m) });

  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (test.status === "ok") onNext();
        else void verify().then((ok) => ok && onNext());
      }}
    >
      <SectionTitle hint={t("location.firebaseHint")}>{t("location.firebaseTitle")}</SectionTitle>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-surface-600 dark:text-surface-300">
        <li>{t("location.firebaseSteps.project")}</li>
        <li>{t("location.firebaseSteps.app")}</li>
        <li>{t("location.firebaseSteps.auth")}</li>
        <li>{t("location.firebaseSteps.firestore")}</li>
        <li>{t("location.firebaseSteps.rules")}</li>
      </ol>
      <FormField label={t("location.firebaseSnippet")} htmlFor="fb-snippet" help={t("location.firebaseSnippetHelp")}>
        <Textarea
          id="fb-snippet"
          rows={3}
          value={snippet}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={'const firebaseConfig = { apiKey: "…", authDomain: "…", projectId: "…", appId: "…" };'}
          onChange={(e) => {
            setSnippet(e.target.value);
            const parsed = parseFirebaseSnippet(e.target.value);
            if (Object.keys(parsed).length) setF(Object.fromEntries(FIREBASE_KEYS.map((k) => [k, (parsed as Record<string, string>)[k] ?? f[k]])) as Partial<FirebaseInput>);
          }}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIREBASE_KEYS.map((k) => (
          <FormField key={k} label={t(`fields.${k}`)} htmlFor={`fb-${k}`}>
            <Input id={`fb-${k}`} value={String(f[k])} autoComplete="off" spellCheck={false} onChange={(e) => setF({ [k]: e.target.value } as Partial<FirebaseInput>)} />
          </FormField>
        ))}
      </div>

      <SectionTitle hint={t("location.firebaseAdminHint")}>{t("location.firebaseAdmin")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("fields.adminEmail")} htmlFor="fb-email">
          <Input id="fb-email" type="email" autoComplete="off" value={f.adminEmail} onChange={(e) => setF({ adminEmail: e.target.value })} />
        </FormField>
        <FormField label={t("fields.adminPassword")} htmlFor="fb-password">
          <SecretInput id="fb-password" value={f.adminPassword} onChange={(v) => setF({ adminPassword: v })} />
        </FormField>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox label={t("location.methodPassword")} checked={f.signInMethods.includes("password")} onChange={(e) => toggleMethod("password", e.target.checked)} />
        <Checkbox label={t("location.methodGoogle")} checked={f.signInMethods.includes("google")} onChange={(e) => toggleMethod("google", e.target.checked)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("location.signup")} htmlFor="fb-signup" help={t(`location.signupHelp.${f.signup}`)}>
          <Select
            id="fb-signup"
            value={f.signup}
            onChange={(e) => setF({ signup: e.target.value as FirebaseSignup })}
            options={(["invite", "domain", "open"] as const).map((v) => ({ value: v, label: t(`location.signupModes.${v}`) }))}
          />
        </FormField>
        {f.signup === "domain" && (
          <FormField label={t("location.allowedDomains")} htmlFor="fb-domains">
            <Input id="fb-domains" value={f.allowedDomains} placeholder="acme.com, acme.io" onChange={(e) => setF({ allowedDomains: e.target.value })} />
          </FormField>
        )}
      </div>

      <div className="space-y-2">
        <SectionTitle hint={t("location.rulesHint")}>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" /> {t("location.rulesTitle")}
          </span>
        </SectionTitle>
        {rules ? (
          <>
            <RulesPreview rules={rules} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Download />} onClick={() => downloadText(rules, "firestore.rules")}>
                firestore.rules
              </Button>
              <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadText(buildFirestoreIndexes(), "firestore.indexes.json", "application/json")}>
                firestore.indexes.json
              </Button>
              <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadText(buildFirebaseJson(), "firebase.json", "application/json")}>
                firebase.json
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-surface-500">{t("location.rulesNeedEmail")}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <TestButton running={test.status === "running"} onClick={() => void verify()} label={t("location.firebaseVerify")} />
      </div>
      <TestStatus state={test} />
      {state.existing?.exists && <Note tone="info" title={t("location.existingTitle")}>{t("location.existingFirebase")}</Note>}
      <StepFooter onBack={onBack} busy={test.status === "running"} nextIcon={<KeyRound />} />
    </form>
  );
}

function RulesPreview({ rules }: { rules: string }) {
  const { t } = useTranslation("setup");
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button size="xs" variant="ghost" icon={<Lock />} onClick={() => setOpen((o) => !o)}>
        {open ? t("location.rulesHide") : t("location.rulesShow")}
      </Button>
      <div className={cn(!open && "hidden")}>
        <CopyBlock text={rules} />
      </div>
    </div>
  );
}
