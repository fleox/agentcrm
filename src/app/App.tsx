// Root component. Not configured → the setup feature's unconfigured
// routes. Configured → boot the data store (identity → login screen if
// needed → ready() → passphrase prompt if needed), then AuthProvider +
// CrmDataProvider + HashRouter + Layout with every feature's routes.

import { defaultCurrencyFor } from "../core/schema/localize";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nextProvider, useTranslation } from "react-i18next";
import { AlertTriangle, Database, KeyRound, PowerOff, ShieldAlert } from "lucide-react";
import i18n from "../i18n";
import { Button, Card, ConfirmHost, EmptyState, FormField, Input, Spinner, ToastContainer } from "../components/ui";
import { getDataStore, resetDataStore } from "../data";
import type { DataStore, StoreIdentity } from "../data/types";
import { setStorageConfigSource, type StorageConfig } from "../shared/storage/registry";
import { forgetSecrets, getHostingSecrets, getRuntimeConfig, resetRuntimeConfigCache, saveLocalRuntimeConfig, setPassphrase, type RuntimeConfig } from "../lib/runtimeConfig";
import { createOpsContext } from "../ops/context";
import { seedCrm } from "../ops/seed";
import { migrateSchema } from "../ops/migrate";
import type { CrmUser } from "../core/types";
import { resolveCrmUser } from "./auth";
import { AuthProvider, getAuthAdapter, useAuth } from "./AuthContext";
import { CrmDataProvider, useCrm } from "./CrmDataContext";
import { connectModuleState, getAllFeatures, getFeatures, getSlot, useFeatures, useModuleStates } from "./featureRegistry";
import { Layout } from "./Layout";
import { useWorkspaceAppearance } from "./WorkspaceAppearance";
import { paths } from "./paths";
import { useObjects } from "./CrmDataContext";
import { isSafeMode, syncExtensions, watchExtensions, type SyncReport } from "../extensions/loader";
import { toast } from "../shared/lib/toast";
import type { Feature } from "../features/types";

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
  | { phase: "ready"; store: DataStore; identity: StoreIdentity; user: CrmUser; safeMode: boolean; extensionReport: SyncReport }
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
        // Additive schema upgrades (0.3.0 image fields) — admins only, never blocking.
        if (user.role === "admin" && !user.disabled) {
          await migrateSchema(createOpsContext(store, user)).catch((err: unknown) => console.warn("[agentcrm] schema migration skipped:", err));
        }
        // Hosting target of the siteFiles facade: public part in
        // config/hosting, secrets in this browser.
        setStorageConfigSource(async () => {
          const doc = store.get("config", "hosting") as unknown as StorageConfig | undefined;
          return doc?.connectorId ? { connectorId: doc.connectorId, settings: { ...(doc.settings ?? {}), ...getHostingSecrets(config) } } : null;
        });
        // Modules (config/modules) + external extensions before the shell
        // renders, so their routes exist on the first paint. The loader
        // never throws; safe mode skips every extension.
        connectModuleState(store);
        const safeMode = isSafeMode();
        const extensionReport = await syncExtensions(store, { safeMode });
        set({ phase: "ready", store, identity, user, safeMode, extensionReport });
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
              {(user) => <Shell user={user} safeMode={state.safeMode} extensionReport={state.extensionReport} />}
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

// Starts / stops each enabled feature's onStart as modules toggle.
function useFeatureLifecycle(features: Feature[], user: CrmUser): void {
  const running = useRef(new Map<string, { feature: Feature; cleanup: void | (() => void) }>());
  useEffect(() => {
    const map = running.current;
    for (const [id, r] of [...map]) {
      if (!features.includes(r.feature)) {
        if (typeof r.cleanup === "function") r.cleanup();
        map.delete(id);
      }
    }
    for (const f of features) {
      if (map.has(f.id) || !f.onStart) continue;
      try {
        map.set(f.id, { feature: f, cleanup: f.onStart({ user }) });
      } catch (err) {
        console.error(`[features] onStart of ${f.id} failed:`, err);
      }
    }
  }, [features, user]);
  // Features start once per signed-in user.
  useEffect(() => {
    const map = running.current;
    return () => {
      for (const r of map.values()) if (typeof r.cleanup === "function") r.cleanup();
      map.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);
}

function Shell({ user, safeMode, extensionReport }: { user: CrmUser; safeMode: boolean; extensionReport: SyncReport }) {
  const { t } = useTranslation();
  const { store } = useCrm();
  const features = useFeatures();
  const modules = useModuleStates();
  const objects = useObjects();
  useFeatureLifecycle(features, user);
  useWorkspaceAppearance();

  // Live extension updates (install / enable / upgrade / uninstall).
  useEffect(() => {
    const report = (r: SyncReport) => {
      if (r.failed.length) toast.error(t("app.extensionErrors", { count: r.failed.length, list: r.failed.map((f) => `${f.id} (${f.error})`).join(", ") }));
    };
    report(extensionReport);
    return watchExtensions(store, { safeMode, onSync: report });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, safeMode]);

  if (user.disabled) {
    return (
      <CenteredScreen>
        <EmptyState icon={<AlertTriangle />} title={t("errors.forbidden")} />
      </CenteredScreen>
    );
  }
  const allowed = (f: Feature) => f.routes.filter((r) => !r.roles || r.roles.includes(user.role));
  const routes = features.flatMap(allowed);
  // Routes of disabled modules → "module disabled" page.
  const enabledIds = new Set(features.map((f) => f.id));
  const disabledRoutes = getAllFeatures()
    .filter((f) => !enabledIds.has(f.id))
    .flatMap((f) => allowed(f).map((r) => ({ path: r.path, module: f.id })))
    // "/" of a disabled dashboard redirects to the first object instead.
    .filter((r) => r.path !== "/" && !routes.some((x) => x.path === r.path));
  const disabledObjects = modules.filter((m) => !m.enabled).flatMap((m) => m.objects.map((o) => ({ object: o, module: m.id })));
  const hasHome = routes.some((r) => r.path === "/");
  return (
    <HashRouter>
      <Layout banner={safeMode ? <SafeModeBanner /> : undefined}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          {disabledRoutes.map((r) => (
            <Route key={`off:${r.path}`} path={r.path} element={<ModuleDisabledPage moduleId={r.module} />} />
          ))}
          {disabledObjects.flatMap((d) => [
            <Route key={`off:${d.object}`} path={`/objects/${d.object}`} element={<ModuleDisabledPage moduleId={d.module} />} />,
            <Route key={`off:${d.object}/*`} path={`/objects/${d.object}/*`} element={<ModuleDisabledPage moduleId={d.module} />} />,
          ])}
          {!hasHome && objects[0] && <Route path="/" element={<Navigate to={paths.objectList(objects[0].id)} replace />} />}
          <Route path="/setup/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

function SafeModeBanner() {
  const { t } = useTranslation();
  const exit = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("safe");
    url.hash = url.hash.replace(/[?&]safe=[^&]*/, "").replace(/\?$/, "");
    window.location.replace(url.toString());
  };
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{t("app.safeMode.banner")}</span>
      <button type="button" onClick={exit} className="font-medium underline-offset-2 hover:underline">
        {t("app.safeMode.exit")}
      </button>
    </div>
  );
}

// Shown on the routes of a disabled module (admins get a shortcut to
// Settings → Modules).
export function ModuleDisabledPage({ moduleId }: { moduleId: string }) {
  const { t } = useTranslation();
  const { role } = useAuth();
  const modules = useModuleStates();
  const m = modules.find((x) => x.id === moduleId);
  const name = m ? (m.nameKey ? t(m.nameKey) : m.name) : moduleId;
  return (
    <EmptyState
      className="py-24"
      icon={<PowerOff />}
      title={t("app.moduleDisabled.title")}
      description={role === "admin" ? t("app.moduleDisabled.hint", { name }) : t("app.moduleDisabled.hintMember", { name })}
      action={
        role === "admin" ? (
          <Button variant="outline" onClick={() => (window.location.hash = `#${paths.settings("modules")}`)}>
            {t("app.moduleDisabled.open")}
          </Button>
        ) : undefined
      }
    />
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
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState<"plain" | "demo" | null>(null);
  const install = async (demo: boolean) => {
    setBusy(demo ? "demo" : "plain");
    try {
      await seedCrm(createOpsContext(store, null), { admin: { name: identity.displayName || "Admin", email: identity.email || "admin@localhost" }, demo, locale: i18n.language, currency: defaultCurrencyFor(i18n.language) });
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
