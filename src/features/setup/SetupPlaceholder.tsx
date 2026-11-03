import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Database, GitBranch, Lock, Monitor } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input } from "../../components/ui";
import { useAppControl } from "../../app/App";
import { createDataStore } from "../../data";
import { saveLocalRuntimeConfig, type RuntimeConfig } from "../../lib/runtimeConfig";
import { createOpsContext } from "../../ops/context";
import { seedCrm } from "../../ops/seed";
import { cn } from "../../shared/lib/utils";
import { toast } from "../../shared/lib/toast";

type Choice = "local" | "journal" | "firebase" | "git";

export function SetupPlaceholder() {
  const { t } = useTranslation("setup");
  const control = useAppControl();
  const [choice, setChoice] = useState<Choice>("local");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    try {
      const config: RuntimeConfig = { backend: "local" };
      const store = await createDataStore(config);
      await store.ready();
      await seedCrm(createOpsContext(store, null), { admin: { name: name.trim() || "Admin", email: email.trim() || "admin@localhost" }, demo });
      store.close?.();
      saveLocalRuntimeConfig(config);
      control.reconfigure();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const options: { id: Choice; icon: JSX.Element; label: string; hint?: string; disabled?: boolean }[] = [
    { id: "journal", icon: <Lock />, label: t("journal"), hint: t("comingSoon"), disabled: true },
    { id: "firebase", icon: <Cloud />, label: t("firebase"), hint: t("comingSoon"), disabled: true },
    { id: "git", icon: <GitBranch />, label: t("git"), hint: t("comingSoon"), disabled: true },
    { id: "local", icon: <Monitor />, label: t("local"), hint: t("localHint") },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 p-6 dark:bg-surface-950">
      <Card className="w-full max-w-lg">
        <form
          data-form-type="other"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void install();
          }}
        >
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-surface-500" />
            <div>
              <h1 className="text-base font-semibold">{t("title")}</h1>
              <p className="text-sm text-surface-500">{t("subtitle")}</p>
            </div>
          </div>
          <div className="space-y-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled}
                onClick={() => setChoice(o.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-5 [&_svg]:w-5",
                  choice === o.id ? "border-accent-500 bg-accent-50/50 dark:bg-accent-500/10" : "border-surface-200 hover:border-surface-300 dark:border-surface-800",
                )}
              >
                <span className="mt-0.5 text-surface-500">{o.icon}</span>
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  {o.hint && <span className="block text-xs text-surface-500">{o.hint}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("name")} htmlFor="setup-name">
              <Input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </FormField>
            <FormField label={t("email")} htmlFor="setup-email">
              <Input id="setup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </FormField>
          </div>
          <Checkbox label={t("demo")} checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<Database />}>
            {busy ? t("installing") : t("install")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
