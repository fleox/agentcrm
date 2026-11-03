import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Link2, LogOut, Save, Share2 } from "lucide-react";
import { Badge, Button, Card, FormField, Input, Markdown, Switch } from "../../components/ui";
import { useCan, useOps } from "../../app/CrmDataContext";
import { setConfigDoc } from "../../ops/settings";
import { toast } from "../../shared/lib/toast";
import type { IntegrationProvider } from "../../ops/integrations";
import { adminRedirectUri, connectGoogle, connectMicrosoft, disconnect, loadGoogleIdentity } from "./auth";
import { useIntegrations } from "./hooks";
import { getIntegrationSettings, saveIntegrationSettings } from "./state";
import guide from "./INTEGRATIONS.md?raw";

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation("integrations");
  const [copied, setCopied] = useState(false);
  return (
    <FormField label={label}>
      <div className="flex gap-2">
        <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button
          size="md"
          icon={
            <span className="inline-flex">
              <span className={copied ? "hidden" : "inline-flex"}>
                <Copy className="h-4 w-4" />
              </span>
              <span className={copied ? "inline-flex" : "hidden"}>
                <Check className="h-4 w-4" />
              </span>
            </span>
          }
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error(t("settings.copyFailed"));
            }
          }}
        >
          {t("settings.copy")}
        </Button>
      </div>
    </FormField>
  );
}

function ConnectionStatus({ provider }: { provider: IntegrationProvider }) {
  const { t } = useTranslation("integrations");
  const state = useIntegrations();
  const token = provider === "google" ? state.google : state.microsoft;
  return token ? (
    <Badge color="green" dot>
      {token.account ? t("settings.connectedAs", { account: token.account }) : t("settings.connected")}
    </Badge>
  ) : (
    <Badge color="gray" dot>
      {t("settings.notConnected")}
    </Badge>
  );
}

function ProviderCard({ provider }: { provider: IntegrationProvider }) {
  const { t } = useTranslation("integrations");
  const { settings, shared, google, microsoft } = useIntegrations();
  const local = getIntegrationSettings();
  const token = provider === "google" ? google : microsoft;
  const [clientId, setClientId] = useState(provider === "google" ? local.googleClientId : local.microsoftClientId);
  const [tenant, setTenant] = useState(local.microsoftTenant);
  const [busy, setBusy] = useState(false);
  const sharedId = provider === "google" ? shared?.googleClientId : shared?.microsoftClientId;
  const effectiveId = provider === "google" ? settings.googleClientId : settings.microsoftClientId;
  // Preload Google Identity Services so the consent popup opens straight
  // from the click (popup blockers).
  useEffect(() => {
    if (provider === "google" && effectiveId && !token) loadGoogleIdentity().catch(() => undefined);
  }, [provider, effectiveId, token]);

  const save = () =>
    saveIntegrationSettings(provider === "google" ? { googleClientId: clientId } : { microsoftClientId: clientId, microsoftTenant: tenant });

  const connect = async () => {
    // Opens the popup synchronously with the click (popup blockers).
    const next = save();
    const resolved = {
      ...next,
      googleClientId: next.googleClientId || sharedId || "",
      microsoftClientId: next.microsoftClientId || sharedId || "",
      microsoftTenant: next.microsoftTenant || shared?.microsoftTenant || "",
    };
    setBusy(true);
    try {
      const tok = provider === "google" ? await connectGoogle(resolved) : await connectMicrosoft(resolved);
      toast.success(t("settings.connectedToast", { account: tok.account ?? t(`providers.${provider}`) }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t(`providers.${provider}`)} actions={<ConnectionStatus provider={provider} />}>
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
          toast.success(t("settings.saved"));
        }}
      >
        <FormField
          label={t(provider === "google" ? "settings.googleClientId" : "settings.microsoftClientId")}
          htmlFor={`int-${provider}-client`}
          help={!clientId && sharedId ? t("settings.usingShared", { value: sharedId }) : t(provider === "google" ? "settings.googleClientIdHelp" : "settings.microsoftClientIdHelp")}
        >
          <Input
            id={`int-${provider}-client`}
            value={clientId}
            placeholder={sharedId || (provider === "google" ? "1234567890-abc.apps.googleusercontent.com" : "00000000-0000-0000-0000-000000000000")}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setClientId(e.target.value)}
          />
        </FormField>
        {provider === "microsoft" && (
          <FormField label={t("settings.microsoftTenant")} htmlFor="int-ms-tenant" help={t("settings.microsoftTenantHelp")}>
            <Input id="int-ms-tenant" value={tenant} placeholder={shared?.microsoftTenant || "common"} autoComplete="off" spellCheck={false} onChange={(e) => setTenant(e.target.value)} />
          </FormField>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" icon={<Save />}>
            {t("settings.save")}
          </Button>
          {token ? (
            <Button
              variant="outline"
              icon={<LogOut />}
              onClick={async () => {
                await disconnect(provider);
                toast.success(t("settings.disconnected"));
              }}
            >
              {t("settings.disconnect")}
            </Button>
          ) : (
            <Button variant="primary" icon={<Link2 />} loading={busy} disabled={!clientId.trim() && !effectiveId} onClick={connect}>
              {t(provider === "google" ? "settings.connectGoogle" : "settings.connectMicrosoft")}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export function IntegrationsSettingsSection() {
  const { t } = useTranslation("integrations");
  const ops = useOps();
  const isAdmin = useCan("settings.write");
  const { settings, shared } = useIntegrations();
  const [showGuide, setShowGuide] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [redirect, setRedirect] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    setRedirect(adminRedirectUri());
  }, []);

  return (
    <div className="max-w-3xl space-y-4">
      <Card title={t("settings.title")}>
        <p className="mb-4 text-sm text-surface-600 dark:text-surface-300">{t("settings.intro")}</p>
        <div className="space-y-3">
          <CopyField label={t("settings.origin")} value={origin} />
          <CopyField label={t("settings.redirectUri")} value={redirect} />
        </div>
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setShowGuide((v) => !v)}>
            {showGuide ? t("settings.hideGuide") : t("settings.showGuide")}
          </Button>
        </div>
        <div className={showGuide ? "mt-3 max-h-[60vh] overflow-y-auto rounded-md border border-surface-100 p-4 text-sm dark:border-surface-800" : "hidden"}>
          <Markdown source={guide} />
        </div>
      </Card>

      <ProviderCard provider="google" />
      <ProviderCard provider="microsoft" />

      <Card title={t("settings.options")}>
        <div className="space-y-3">
          <Switch checked={settings.autoLog} onChange={(v) => saveIntegrationSettings({ autoLog: v })} label={t("settings.autoLog")} />
          <Switch checked={settings.autoSyncMeetings} onChange={(v) => saveIntegrationSettings({ autoSyncMeetings: v })} label={t("settings.autoSync")} />
          <p className="text-xs text-surface-500">{t("settings.storageNote")}</p>
        </div>
      </Card>

      {isAdmin && (
        <Card title={t("settings.shareTitle")}>
          <p className="mb-3 text-sm text-surface-600 dark:text-surface-300">{t("settings.shareHelp")}</p>
          {shared && (shared.googleClientId || shared.microsoftClientId) && (
            <p className="mb-3 text-xs text-surface-500">
              {t("settings.sharedNow", { google: shared.googleClientId || "—", microsoft: shared.microsoftClientId || "—" })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Share2 />}
              loading={sharing}
              disabled={!settings.googleClientId && !settings.microsoftClientId}
              onClick={async () => {
                setSharing(true);
                try {
                  await setConfigDoc(ops, "integrations", {
                    googleClientId: settings.googleClientId,
                    microsoftClientId: settings.microsoftClientId,
                    microsoftTenant: settings.microsoftTenant,
                  });
                  toast.success(t("settings.shared"));
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setSharing(false);
                }
              }}
            >
              {t("settings.share")}
            </Button>
            {shared && (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await setConfigDoc(ops, "integrations", null);
                    toast.success(t("settings.unshared"));
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                {t("settings.unshare")}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
