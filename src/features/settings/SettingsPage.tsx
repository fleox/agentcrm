import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Save, Settings } from "lucide-react";
import { Button, Card, FormField, Input, PageHeader, Tabs } from "../../components/ui";
import { useCan, useOps, useSettings } from "../../app/CrmDataContext";
import { useAuth } from "../../app/AuthContext";
import { getSlot } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import { updateSettings } from "../../ops/settings";
import { toast } from "../../shared/lib/toast";

function GeneralSection() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const settings = useSettings();
  const canEdit = useCan("settings.write");
  const { backend } = useAuth();
  const [name, setName] = useState(settings.name);
  const [currency, setCurrency] = useState(settings.defaultCurrency);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(settings.name);
    setCurrency(settings.defaultCurrency);
  }, [settings.name, settings.defaultCurrency]);
  return (
    <Card title={t("general")} className="max-w-xl">
      <form
        data-form-type="other"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await updateSettings(ops, { name, defaultCurrency: currency });
            toast.success(t("saved"));
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <FormField label={t("name")} htmlFor="crm-name">
          <Input id="crm-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={t("currency")} htmlFor="crm-currency">
          <Input id="crm-currency" value={currency} maxLength={3} disabled={!canEdit} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </FormField>
        <FormField label={t("backend")}>
          <div className="text-sm text-surface-600 dark:text-surface-300">{backend}</div>
        </FormField>
        {canEdit && (
          <Button type="submit" variant="primary" icon={<Save />} loading={saving}>
            {tc("common.save")}
          </Button>
        )}
      </form>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const { section = "general" } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const extra = getSlot("settingsSections").filter((s) => !s.roles || s.roles.includes(role));
  const Active = extra.find((s) => s.id === section)?.component;
  return (
    <div>
      <PageHeader title={t("title")} icon={<Settings />}>
        <Tabs className="-mb-3 mt-2 border-b-0" tabs={[{ id: "general", label: t("general") }, ...extra.map((s) => ({ id: s.id, label: tc(s.label) }))]} value={section} onChange={(id) => navigate(paths.settings(id === "general" ? undefined : id))} />
      </PageHeader>
      <div className="p-6">{Active ? <Active /> : <GeneralSection />}</div>
    </div>
  );
}
