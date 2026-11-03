// Root component. Not configured → the setup feature's unconfigured
// routes. Configured → boot the data store (identity → login screen if
// needed → ready() → passphrase prompt if needed), then AuthProvider +
// CrmDataProvider + HashRouter + Layout with every feature's routes.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nextProvider, useTranslation } from "react-i18next";
import { AlertTriangle, Database, KeyRound } from "lucide-react";
import i18n from "../i18n";
import { Button, Card, ConfirmHost, EmptyState, FormField, Input, Spinner, ToastContainer } from "../components/ui";
import { getDataStore, resetDataStore } from "../data";
import type { DataStore, StoreIdentity } from "../data/types";
import { setStorageConfigSource, type StorageConfig } from "../shared/storage/registry";
import { forgetSecrets, getHostingSecrets, getRuntimeConfig, resetRuntimeConfigCache, saveLocalRuntimeConfig, setPassphrase, type RuntimeConfig } from "../lib/runtimeConfig";
import { createOpsContext } from "../ops/context";
import { seedCrm } from "../ops/seed";
import type { CrmUser } from "../core/types";
import { resolveCrmUser } from "./auth";
import { AuthProvider, getAuthAdapter } from "./AuthContext";
import { CrmDataProvider, useCrm } from "./CrmDataContext";
import { getFeatures, getSlot } from "./featureRegistry";
import { Layout } from "./Layout";

// ─── App control (setup wizard → "configured") ──────────────────────────

export interface AppControl {
  // Re-reads the runtime config and reboots the data layer (after the
  // setup wizard saved a config, or Settings switched backend).
  reconfigure(): void;
}

const AppControlContext = createContext<AppControl>({ reconfigure: () => window.location.reload() });

export function useAppControl(): AppControl {
  return useContext(AppControlContext);
}

export function App() {
  const [version, setVersion] = useState(0);
  const config = useMemo(() => {
    resetRuntimeConfigCache();
    return getRuntimeConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const control = useMemo<AppControl>(
    () => ({
      reconfigure: () => {
        resetRuntimeConfigCache();
        resetDataStore();
        setVersion((v) => v + 1);
      },
    }),
    [],
  );
  return (
    <I18nextProvider i18n={i18n}>
      <AppControlContext.Provider value={control}>
        {config ? <ConfiguredApp key={version} config={config} /> : <UnconfiguredApp />}
        <ToastContainer />
        <ConfirmHost />
      </AppControlContext.Provider>
    </I18nextProvider>
  );
}

function UnconfiguredApp() {
  const { t } = useTranslation();
  const routes = getFeatures().flatMap((f) => f.unconfiguredRoutes ?? []);
  return (
    <HashRouter>
      <Routes>
        {routes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        {!routes.some((r) => r.path === "*" || r.path === "/*") && <Route path="*" element={<CenteredScreen><EmptyState icon={<Database />} title={t("setupRequired.title")} /></CenteredScreen>} />}
      </Routes>
    </HashRouter>
  );
}

// ─── Boot ───────────────────────────────────────────────────────────────

type BootState =
  | { phase: "loading" }
  | { phase: "signIn"; store: DataStore }
  | { phase: "passphrase"; store: DataStore; wrong: boolean }
  | { phase: "empty"; store: DataStore; identity: StoreIdentity }
  | { phase: "ready"; store: DataStore; identity: StoreIdentity; user: CrmUser }
  | { phase: "error"; error: Error };

function CenteredScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-surface-50 p-6 dark:bg-surface-950">{children}</div>;
}

function ConfiguredApp({ config }: { config: RuntimeConfig }) {
  const [state, setState] = useState<BootState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    const set = (s: BootState) => !cancelled && setState(s);
    (async () => {
      let store: DataStore;
      try {
        store = await getDataStore();
      } catch (err) {
        return set({ phase: "error", error: err as Error });
      }
      try {
        const identity = await store.identity();
        if (!identity) return set({ phase: "signIn", store });
        await store.ready();
        if (store.list("objects").length === 0) return set({ phase: "empty", store, identity });
        const user = resolveCrmUser(store, identity);
        if (!user) return set({ phase: "signIn", store });
        // Hosting target of the siteFiles facade: public part in
        // config/hosting, secrets in this browser.
        setStorageConfigSource(async () => {
          const doc = store.get("config", "hosting") as unknown as StorageConfig | undefined;
          return doc?.connectorId ? { connectorId: doc.connectorId, settings: { ...(doc.settings ?? {}), ...getHostingSecrets(config) } } : null;
        });
        set({ phase: "ready", store, identity, user });
      } catch (err) {
        const e = err as Error & { reason?: string };
        if (e.name === "PassphraseError") return set({ phase: "passphrase", store, wrong: e.reason === "wrong" });
        set({ phase: "error", error: e });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, config]);

  // Backends with accounts sign out through their adapter; the others
  // forget this browser's secrets (journal: "lock").
  const signOut = useCallback(async () => {
    const adapter = getAuthAdapter(config.backend);
    if (adapter) await adapter.signOut();
    else forgetSecrets(config);
    resetDataStore();
    retry();
  }, [config, retry]);

  switch (state.phase) {
    case "loading":
      return (
        <CenteredScreen>
          <Spinner size="lg" />
        </CenteredScreen>
      );
    case "error":
      return <BootError error={state.error} onRetry={retry} />;
    case "passphrase":
      return <PassphraseGate config={config} wrong={state.wrong} onSubmit={retry} />;
    case "signIn":
      return <SignInScreen onSignedIn={retry} />;
    case "empty":
      return <EmptyDataset store={state.store} identity={state.identity} onDone={retry} />;
    case "ready":
      return (
        <AuthProvider backend={config.backend} identity={state.identity} user={state.user} onSignOut={signOut}>
          <CrmDataProvider store={state.store} user={state.user}>
            <LiveUser identity={state.identity} initial={state.user}>
              {(user) => <Shell user={user} />}
            </LiveUser>
          </CrmDataProvider>
        </AuthProvider>
      );
  }
}

// Re-resolves the signed-in user when the users collection changes.
function LiveUser({ identity, initial, children }: { identity: StoreIdentity; initial: CrmUser; children: (u: CrmUser) => ReactNode }) {
  const { store } = useCrm();
  const [user, setUser] = useState(initial);
  useEffect(
    () =>
      store.subscribe((changed) => {
        if (!changed.has("users") && !changed.has("settings")) return;
        const next = resolveCrmUser(store, identity);
        if (next && JSON.stringify(next) !== JSON.stringify(user)) setUser(next);
      }),
    [store, identity, user],
  );
  return <>{children(user)}</>;
}

function Shell({ user }: { user: CrmUser }) {
  const { t } = useTranslation();
  useEffect(() => {
    const cleanups = getFeatures().map((f) => f.onStart?.({ user }));
    return () => cleanups.forEach((c) => typeof c === "function" && c());
    // Features start once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);
  if (user.disabled) {
    return (
      <CenteredScreen>
        <EmptyState icon={<AlertTriangle />} title={t("errors.forbidden")} />
      </CenteredScreen>
    );
  }
  const routes = getFeatures()
    .flatMap((f) => f.routes)
    .filter((r) => !r.roles || r.roles.includes(user.role));
  return (
    <HashRouter>
      <Layout>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="/setup/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState
      className="py-24"
      title={t("app.notFound")}
      action={
        <Button variant="outline" onClick={() => (window.location.hash = "#/")}>
          {t("app.backHome")}
        </Button>
      }
    />
  );
}

function BootError({ error, onRetry }: { error: Error; onRetry(): void }) {
  const { t } = useTranslation();
  const control = useAppControl();
  return (
    <CenteredScreen>
      <Card className="w-full max-w-md">
        <EmptyState
          icon={<AlertTriangle />}
          title={t("app.loadError")}
          description={<span className="break-words font-mono text-xs">{error.message}</span>}
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={onRetry}>
                {t("app.retry")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  saveLocalRuntimeConfig(null);
                  control.reconfigure();
                }}
              >
                {t("app.resetSetup")}
              </Button>
            </div>
          }
        />
      </Card>
    </CenteredScreen>
  );
}

function PassphraseGate({ config, wrong, onSubmit }: { config: RuntimeConfig; wrong: boolean; onSubmit(): void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  return (
    <CenteredScreen>
      <Card className="w-full max-w-sm">
        <form
          data-form-type="other"
          onSubmit={(e) => {
            e.preventDefault();
            setPassphrase(config, value.trim());
            onSubmit();
          }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-surface-500" />
            <h1 className="text-base font-semibold">{t("app.passphraseTitle")}</h1>
          </div>
          <p className="text-sm text-surface-500">{t("app.passphraseHint")}</p>
          <FormField label={t("app.passphrase")} htmlFor="passphrase" error={wrong ? t("app.passphraseWrong") : undefined}>
            <Input id="passphrase" type="password" autoComplete="off" autoFocus value={value} onChange={(e) => setValue(e.target.value)} invalid={wrong} />
          </FormField>
          <Button type="submit" variant="primary" className="w-full" disabled={!value.trim()} icon={<KeyRound />}>
            {t("app.unlock")}
          </Button>
        </form>
      </Card>
    </CenteredScreen>
  );
}

function SignInScreen({ onSignedIn }: { onSignedIn(): void }) {
  const { t } = useTranslation();
  const Login = getSlot("loginScreen")[0];
  if (Login) return <Login onSignedIn={onSignedIn} />;
  return (
    <CenteredScreen>
      <EmptyState icon={<KeyRound />} title={t("errors.forbidden")} />
    </CenteredScreen>
  );
}

// A configured but empty dataset (fresh local store): offer to install.
function EmptyDataset({ store, identity, onDone }: { store: DataStore; identity: StoreIdentity; onDone(): void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"plain" | "demo" | null>(null);
  const install = async (demo: boolean) => {
    setBusy(demo ? "demo" : "plain");
    try {
      await seedCrm(createOpsContext(store, null), { admin: { name: identity.displayName || "Admin", email: identity.email || "admin@localhost" }, demo });
      onDone();
    } finally {
      setBusy(null);
    }
  };
  return (
    <CenteredScreen>
      <Card className="w-full max-w-md">
        <EmptyState
          icon={<Database />}
          title={t("app.emptyTitle")}
          description={t("app.emptyHint")}
          action={
            <div className="flex gap-2">
              <Button variant="primary" loading={busy === "demo"} disabled={!!busy} onClick={() => void install(true)}>
                {t("app.installDemo")}
              </Button>
              <Button variant="outline" loading={busy === "plain"} disabled={!!busy} onClick={() => void install(false)}>
                {t("app.installEmpty")}
              </Button>
            </div>
          }
        />
      </Card>
    </CenteredScreen>
  );
}
