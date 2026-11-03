// Settings → Security (everyone): your role and what it allows, which
// secrets this browser holds for this CRM (and where), forget them, sign
// out.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, KeyRound, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, confirmDialog } from "../../../components/ui";
import { useAppControl } from "../../../app/App";
import { useAuth } from "../../../app/AuthContext";
import { resetDataStore } from "../../../data";
import { datasetId, forgetSecrets, getConnectorSecrets, getGitToken, getHostingSecrets, getPassphrase, getRuntimeConfig, setSecret, setSecretJson } from "../../../lib/runtimeConfig";
import { cn } from "../../../shared/lib/utils";
import { Note } from "../components/SetupUi";

export function SecuritySection() {
  const { t } = useTranslation("setup");
  const { role, backend, canSignOut, signOut, identity } = useAuth();
  const control = useAppControl();
  const config = getRuntimeConfig();

  const held = useMemo(() => {
    if (!config) return [];
    const rows: { id: string; present: boolean }[] = [];
    if (config.backend === "journal") {
      rows.push({ id: "connector", present: Object.keys(getConnectorSecrets(config)).length > 0 });
      if (config.journal.encrypted) rows.push({ id: "passphrase", present: !!getPassphrase(config) });
    }
    if (config.backend === "git-json" && config.git.provider !== "local") rows.push({ id: "gitToken", present: !!getGitToken(config.git) });
    if (config.backend === "firebase") rows.push({ id: "firebaseSession", present: true });
    rows.push({ id: "hosting", present: Object.keys(getHostingSecrets(config)).length > 0 });
    return rows;
  }, [config]);

  if (!config) return null;

  const forget = async () => {
    if (!(await confirmDialog({ title: t("settings.security.forgetConfirmTitle"), description: t("settings.security.forgetConfirmBody"), confirmLabel: t("settings.security.forget"), danger: true }))) return;
    forgetSecrets(config);
    const id = datasetId(config);
    setSecretJson(`gitSecrets:${id}`, null);
    setSecret(`gitEmail:${id}`, null);
    if (backend === "firebase") await signOut().catch(() => undefined);
    resetDataStore();
    control.reconfigure();
  };

  return (
    <div className="max-w-3xl space-y-5">
      <Card title={t("settings.security.roleTitle")}>
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-surface-500" />
            {t("settings.security.signedInAs", { email: identity.email || identity.displayName })}
            <Badge color={role === "admin" ? "purple" : role === "member" ? "blue" : "gray"}>{t(`roles.${role}`)}</Badge>
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {(["admin", "member", "viewer"] as const).map((r) => (
              <li key={r} className={cn("rounded-lg border p-3 text-xs", r === role ? "border-accent-500 bg-accent-50/50 dark:bg-accent-500/10" : "border-surface-200 dark:border-surface-800")}>
                <p className="mb-1 font-semibold">{t(`roles.${r}`)}</p>
                <p className="text-surface-500">{t(`roles.${r}Hint`)}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-surface-500">{t(`settings.security.enforcement.${config.backend}`)}</p>
        </div>
      </Card>

      <Card title={t("settings.security.secretsTitle")}>
        <div className="space-y-3">
          <p className="text-sm text-surface-500">{t("settings.security.secretsHint")}</p>
          <ul className="space-y-1.5 text-sm">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <span className={cn("[&>svg]:h-4 [&>svg]:w-4", h.present ? "text-emerald-600" : "text-surface-300")}>
                  <span className={cn("inline-flex", !h.present && "hidden")}>
                    <CheckCircle2 />
                  </span>
                  <span className={cn("inline-flex", h.present && "hidden")}>
                    <Circle />
                  </span>
                </span>
                {t(`settings.security.secrets.${h.id}`)}
              </li>
            ))}
          </ul>
          <Note tone="info">{t("settings.security.neverShared")}</Note>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" icon={<Trash2 />} onClick={() => void forget()}>
              {t("settings.security.forget")}
            </Button>
            {canSignOut && (
              <Button icon={backend === "journal" ? <KeyRound /> : <LogOut />} onClick={() => void signOut()}>
                {backend === "journal" ? t("settings.security.lock") : t("access.signOut")}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
