// Settings → Admin hosting (admins): the target the admin is published
// to (config/hosting holds the public part, this browser the secrets),
// deploy / update the admin there, download config.js or a ZIP.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Download, ExternalLink, Rocket, Save } from "lucide-react";
import { Button, Card } from "../../../components/ui";
import { useCrm, useConfigDoc } from "../../../app/CrmDataContext";
import { getHostingSecrets, getRuntimeConfig } from "../../../lib/runtimeConfig";
import { setConfigDoc } from "../../../ops/settings";
import { createOpsContext } from "../../../ops/context";
import { toast } from "../../../shared/lib/toast";
import { adminUrlOn, buildAdminZip, deployAdmin, downloadBlob, downloadConfigJs } from "../services/adminDeploy";
import { hostingTarget, saveHostingConfig } from "../services/installers";
import { hostingOptionFor } from "../services/locations";
import { Note } from "../components/SetupUi";
import { HostingForm, type HostingValue } from "../steps/HostingStep";

interface HostingDoc {
  connectorId?: string;
  optionId?: string;
  settings?: Record<string, unknown>;
  folder?: string;
}

export function AdminHostingSection() {
  const { t } = useTranslation("setup");
  const { store, user } = useCrm();
  const config = getRuntimeConfig();
  const doc = useConfigDoc<HostingDoc>("hosting");
  const [value, setValue] = useState<HostingValue>(() => ({
    optionId: doc?.connectorId ? hostingOptionFor(doc.connectorId, doc.settings ?? {}).id : "none",
    settings: { ...(doc?.settings ?? {}), ...(config ? getHostingSecrets(config) : {}) },
    folder: doc?.folder ?? "admin",
    folderName: null,
  }));
  const [busy, setBusy] = useState<null | "save" | "deploy" | "zip">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(doc?.settings ? adminUrlOn(doc.settings, doc.folder ?? "admin") : null);
  if (!config) return null;

  const save = async () => {
    setBusy("save");
    try {
      if (value.optionId === "none" || value.optionId === "zip") await setConfigDoc(createOpsContext(store, user), "hosting", null);
      else await saveHostingConfig(store, config, value, user);
      toast.success(t("settings.hosting.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const deploy = async () => {
    const target = hostingTarget(value);
    if (!target) return;
    setBusy("deploy");
    try {
      await saveHostingConfig(store, config, value, user);
      const res = await deployAdmin(target, value.folder || "admin", config, (done, total) => setProgress(`${done}/${total}`));
      setUrl(res.url);
      toast.success(t("settings.hosting.deployed", { count: res.files, version: res.version }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const zip = async () => {
    setBusy("zip");
    try {
      downloadBlob(await buildAdminZip(config, (done, total) => setProgress(`${done}/${total}`)), "agentcrm-admin.zip");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const deployable = value.optionId !== "none" && value.optionId !== "zip";

  return (
    <div className="max-w-3xl space-y-5">
      <Card title={t("settings.hosting.title")}>
        <div className="space-y-4">
          <p className="text-sm text-surface-500">{t("hosting.hint")}</p>
          <Note tone="warning" title={t("hosting.securityTitle")}>
            {t("hosting.securityBody")}
          </Note>
          <HostingForm value={value} onChange={setValue} />
          {url && (
            <Note tone="success" title={t("settings.hosting.currentUrl")}>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                {url} <ExternalLink className="h-3 w-3" />
              </a>
            </Note>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-surface-100 pt-4 dark:border-surface-800">
            <Button icon={<Save />} loading={busy === "save"} disabled={!!busy} onClick={() => void save()}>
              {t("common.save")}
            </Button>
            {deployable && (
              <Button variant="primary" icon={<Rocket />} loading={busy === "deploy"} disabled={!!busy} onClick={() => void deploy()}>
                {t("settings.hosting.deploy")}
                {busy === "deploy" && progress ? ` ${progress}` : ""}
              </Button>
            )}
            <Button variant="ghost" icon={<Download />} onClick={() => downloadConfigJs(config)}>
              config.js
            </Button>
            <Button variant="ghost" icon={<Archive />} loading={busy === "zip"} disabled={!!busy} onClick={() => void zip()}>
              {t("settings.hosting.zip")}
              {busy === "zip" && progress ? ` ${progress}` : ""}
            </Button>
          </div>
          <p className="text-xs text-surface-500">{t("settings.hosting.devNote")}</p>
        </div>
      </Card>
    </div>
  );
}
