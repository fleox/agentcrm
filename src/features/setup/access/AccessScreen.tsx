// The `loginScreen` slot: shown by the App boot flow when
// store.identity() is null. One component per backend:
//   - firebase  → sign in (email/password, Google, reset) + "verify your
//                 email" / "not invited" states;
//   - git-json  → this browser's personal access token (repo permission
//                 → role) or re-grant of the local clone folder;
//   - journal   → connector secrets for a new browser (S3 keys / git
//                 token) + passphrase, validated before saving; or
//                 re-grant of the local data folder.

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, KeyRound, LogIn, LogOut, Mail, RefreshCw, Shield } from "lucide-react";
import { Button, Card, FormField, Input, Spinner } from "../../../components/ui";
import { useAppControl } from "../../../app/App";
import { getDataStore, resetDataStore } from "../../../data";
import { CONNECTOR_SECRET_FIELDS, missingJournalAccess } from "../../../data/journal/access";
import { checkJournalPassphrase } from "../../../data/journal/rekey";
import {
  getConnectorSecrets,
  getPassphrase,
  getRuntimeConfig,
  saveLocalRuntimeConfig,
  setConnectorSecrets,
  setPassphrase,
  type FirebaseRuntimeConfig,
  type GitJsonRuntimeConfig,
  type JournalRuntimeConfig,
} from "../../../lib/runtimeConfig";
import { instantiateStorageConnector } from "../../../shared/storage/registry";
import { ensureFolderPermission, loadFolderHandle, pickLocalFolder, saveFolderHandle } from "../../../shared/git";
import { toast } from "../../../shared/lib/toast";
import { Note, SecretInput } from "../components/SetupUi";
import { describeLocation } from "../services/locations";

export function AccessScreen({ onSignedIn }: { onSignedIn(): void }) {
  const config = getRuntimeConfig();
  if (config?.backend === "firebase") return <FirebaseLogin config={config} onSignedIn={onSignedIn} />;
  if (config?.backend === "git-json") return <GitAccess config={config} onSignedIn={onSignedIn} />;
  if (config?.backend === "journal") return <JournalAccess config={config} onSignedIn={onSignedIn} />;
  return <AccessShell title="AgentCRM" icon={<Shield />} />;
}

function AccessShell({ title, hint, icon, children, footer }: { title: ReactNode; hint?: ReactNode; icon: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 p-4 dark:bg-surface-950">
      <div className="w-full max-w-sm space-y-3">
        <Card className="p-5">
          <div className="mb-4 flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-900 text-white dark:bg-white dark:text-surface-900 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h1>
              {hint && <p className="mt-0.5 text-xs text-surface-500">{hint}</p>}
            </div>
          </div>
          {children}
        </Card>
        {footer}
      </div>
    </div>
  );
}

function OtherCrmLink() {
  const { t } = useTranslation("setup");
  const control = useAppControl();
  return (
    <div className="text-center">
      <button
        type="button"
        className="text-xs text-surface-500 underline-offset-2 hover:underline"
        onClick={() => {
          saveLocalRuntimeConfig(null);
          control.reconfigure();
        }}
      >
        {t("access.otherCrm")}
      </button>
    </div>
  );
}

// ─── Firebase ────────────────────────────────────────────────────────────

function authErrorKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-email": "invalidEmail",
    "auth/invalid-credential": "invalidCredentials",
    "auth/wrong-password": "invalidCredentials",
    "auth/user-not-found": "invalidCredentials",
    "auth/too-many-requests": "tooManyRequests",
    "auth/user-disabled": "userDisabled",
    "auth/network-request-failed": "network",
    "auth/popup-closed-by-user": "popupClosed",
    "auth/cancelled-popup-request": "popupClosed",
    "auth/popup-blocked": "popupBlocked",
    "auth/unauthorized-domain": "unauthorizedDomain",
    "auth/operation-not-allowed": "methodDisabled",
  };
  return `access.firebaseErrors.${map[code] ?? "generic"}`;
}

function FirebaseLogin({ config, onSignedIn }: { config: FirebaseRuntimeConfig; onSignedIn(): void }) {
  const { t } = useTranslation("setup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "password" | "google" | "reset" | "verify" | "signOut">(null);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<{ reason: string; email?: string } | null>(null);
  const methods = config.signInMethods?.length ? config.signInMethods : ["password"];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { isFirebaseStore } = await import("../../../data/firebase");
      const store = await getDataStore().catch(() => null);
      if (!cancelled && store && isFirebaseStore(store)) {
        const e = store.accessError();
        if (e) setAccess({ reason: e.reason, email: e.email });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const api = async () => (await import("../../../data/firebase")).firebaseApiFor(config);
  const done = async () => {
    const { isFirebaseStore } = await import("../../../data/firebase");
    const store = await getDataStore().catch(() => null);
    if (store && isFirebaseStore(store)) {
      store.resetSession();
      const id = await store.identity();
      if (!id) {
        const e = store.accessError();
        setAccess(e ? { reason: e.reason, email: e.email } : null);
        return;
      }
    }
    onSignedIn();
  };
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  if (access) {
    return (
      <AccessShell title={t(`access.firebase.${access.reason}Title`)} hint={access.email} icon={<Mail />} footer={<OtherCrmLink />}>
        <div className="space-y-3">
          <p className="text-sm text-surface-600 dark:text-surface-300">{t(`access.firebase.${access.reason}Body`)}</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {access.reason === "unverified" && (
              <>
                <Button size="sm" variant="primary" icon={<RefreshCw />} loading={busy === "verify"} onClick={() => void run("verify", async () => { await (await api()).auth.reload(); await done(); })}>
                  {t("access.firebase.verified")}
                </Button>
                <Button size="sm" icon={<Mail />} onClick={() => void run("reset", async () => { await (await api()).auth.sendVerificationEmail(); toast.success(t("access.firebase.verificationSent")); })}>
                  {t("access.firebase.resend")}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" icon={<LogOut />} loading={busy === "signOut"} onClick={() => void run("signOut", async () => { await (await api()).auth.signOut(); setAccess(null); })}>
              {t("access.signOut")}
            </Button>
          </div>
        </div>
      </AccessShell>
    );
  }

  return (
    <AccessShell title={t("access.firebase.title", { name: config.name ?? "AgentCRM" })} hint={t("access.firebase.hint")} icon={<LogIn />} footer={<OtherCrmLink />}>
      <div className="space-y-4">
        {methods.includes("google") && (
          <Button className="w-full" icon={<GoogleIcon />} loading={busy === "google"} disabled={!!busy} onClick={() => void run("google", async () => { await (await api()).auth.signInWithGoogle(); await done(); })}>
            {t("access.firebase.google")}
          </Button>
        )}
        {methods.includes("google") && methods.includes("password") && (
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-surface-400">
            <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" /> {t("access.or")} <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
          </div>
        )}
        {methods.includes("password") && (
          <form
            data-form-type="other"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("password", async () => {
                await (await api()).auth.signInWithPassword(email, password);
                await done();
              });
            }}
          >
            <FormField label={t("access.email")} htmlFor="fb-login-email">
              <Input id="fb-login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label={t("access.password")} htmlFor="fb-login-password">
              <Input id="fb-login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" icon={<LogIn />} loading={busy === "password"} disabled={!!busy || !email || !password}>
              {t("access.signIn")}
            </Button>
            <button
              type="button"
              className="text-xs text-surface-500 hover:underline"
              disabled={!!busy}
              onClick={() => {
                if (!email.trim()) return setError(t("access.firebase.resetNeedsEmail"));
                void run("reset", async () => {
                  await (await api()).auth.sendPasswordReset(email);
                  toast.success(t("access.firebase.resetSent", { email }));
                });
              }}
            >
              {t("access.firebase.forgot")}
            </button>
          </form>
        )}
        {!methods.includes("password") && error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </AccessShell>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

// ─── git-json ────────────────────────────────────────────────────────────

function GitAccess({ config, onSignedIn }: { config: GitJsonRuntimeConfig; onSignedIn(): void }) {
  const { t } = useTranslation("setup");
  const g = config.git;
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = g.provider === "github" ? `${g.owner}/${g.repo}` : g.provider === "gitlab" ? (g.project ?? "") : t("location.gitLocal");

  useEffect(() => {
    void import("../../../data/gitJson").then((m) => setEmail(m.getGitUserEmail(config) ?? ""));
  }, [config]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await import("../../../data/gitJson");
      if (g.provider === "local") {
        let handle = await loadFolderHandle(m.LOCAL_GIT_HANDLE_KEY);
        if (!handle) {
          handle = await pickLocalFolder();
          await saveFolderHandle(m.LOCAL_GIT_HANDLE_KEY, handle);
        }
        if (!(await ensureFolderPermission(handle, true))) throw new Error(t("access.folderDenied"));
      } else {
        const transport = await m.openGitJsonTransport(g, token.trim());
        if (!transport) throw new Error(t("access.git.tokenRequired"));
        const perms = await transport.permissions().catch(() => null);
        if (!perms) throw new Error(t("access.git.invalidToken"));
        m.setGitToken(g, token.trim());
      }
      m.setGitUserEmail(config, email);
      resetDataStore();
      onSignedIn();
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccessShell title={t("access.git.title")} hint={t("access.git.hint", { repo })} icon={<KeyRound />} footer={<OtherCrmLink />}>
      <form
        data-form-type="other"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {g.provider !== "local" && (
          <FormField label={t("access.git.token")} htmlFor="git-token" help={t(g.provider === "github" ? "access.git.githubTokenHelp" : "access.git.gitlabTokenHelp")}>
            <SecretInput id="git-token" value={token} onChange={setToken} />
          </FormField>
        )}
        <FormField label={t("access.git.email")} htmlFor="git-email" help={t("access.git.emailHelp")}>
          <Input id="git-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={g.provider !== "local" && !token.trim()} icon={g.provider === "local" ? <FolderOpen /> : <KeyRound />}>
          {g.provider === "local" ? t("access.reconnectFolder") : t("access.git.connect")}
        </Button>
        <p className="text-[11px] text-surface-500">{t("access.storedHere")}</p>
      </form>
    </AccessShell>
  );
}

// ─── Journal ─────────────────────────────────────────────────────────────

function JournalAccess({ config, onSignedIn }: { config: JournalRuntimeConfig; onSignedIn(): void }) {
  const { t } = useTranslation("setup");
  const j = config.journal;
  const secretKeys = CONNECTOR_SECRET_FIELDS[j.connectorId] ?? [];
  const [secrets, setSecrets] = useState<Record<string, string>>(() => {
    const stored = getConnectorSecrets(config);
    return Object.fromEntries(secretKeys.map((k) => [k, typeof stored[k] === "string" ? (stored[k] as string) : ""]));
  });
  const [passphrase, setPass] = useState(getPassphrase(config) ?? "");
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void missingJournalAccess(j.connectorId, { ...j.settings, ...getConnectorSecrets(config) }).then(setMissing);
  }, [config, j]);

  const folderOnly = j.connectorId === "local-folder";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (folderOnly) {
        const key = typeof j.settings.handleKey === "string" && j.settings.handleKey ? j.settings.handleKey : "data-folder";
        let handle = await loadFolderHandle(key);
        if (!handle) {
          handle = await pickLocalFolder();
          await saveFolderHandle(key, handle);
        }
        if (!(await ensureFolderPermission(handle, true))) throw new Error(t("access.folderDenied"));
      }
      const clean = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      const connector = instantiateStorageConnector(j.connectorId, { ...j.settings, ...clean });
      const check = await checkJournalPassphrase(connector, j.root, passphrase.trim() || null);
      if (!check.exists) throw new Error(t("access.journal.noDataset"));
      if (check.encrypted && !check.ok) throw new Error(t("access.journal.wrongPassphrase"));
      setConnectorSecrets(config, Object.keys(clean).length ? clean : null);
      setPassphrase(config, check.encrypted ? passphrase.trim() : null);
      resetDataStore();
      onSignedIn();
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (missing === null) {
    return (
      <AccessShell title={t("access.journal.title")} icon={<Shield />}>
        <Spinner />
      </AccessShell>
    );
  }

  return (
    <AccessShell
      title={t("access.journal.title")}
      hint={t("access.journal.hint", { location: `${describeLocation(j.connectorId, j.settings)} / ${j.root}` })}
      icon={<Shield />}
      footer={<OtherCrmLink />}
    >
      <form
        data-form-type="other"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {secretKeys.map((k) => (
          <FormField key={k} label={t(`fields.${k}`)} htmlFor={`acc-${k}`}>
            <SecretInput id={`acc-${k}`} value={secrets[k] ?? ""} onChange={(v) => setSecrets((s) => ({ ...s, [k]: v }))} />
          </FormField>
        ))}
        {folderOnly && <Note tone="info">{t("access.journal.folderHint")}</Note>}
        {j.encrypted && (
          <FormField label={t("passphrase.existingLabel")} htmlFor="acc-pass" help={t("access.journal.passphraseHelp")}>
            <SecretInput id="acc-pass" value={passphrase} onChange={setPass} />
          </FormField>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={busy}
          icon={folderOnly ? <FolderOpen /> : <KeyRound />}
          disabled={secretKeys.some((k) => !secrets[k]?.trim()) || (j.encrypted && !passphrase.trim())}
        >
          {folderOnly ? t("access.reconnectFolder") : t("access.journal.unlock")}
        </Button>
        <p className="text-[11px] text-surface-500">{t("access.storedHere")}</p>
      </form>
    </AccessShell>
  );
}
