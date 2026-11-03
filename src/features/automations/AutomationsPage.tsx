import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/ui";

export function AutomationsPage() {
  const { t } = useTranslation("automations");
  return (
    <div>
      <PageHeader title={t("title")} icon={<Zap />} />
      <EmptyState className="py-24" icon={<Zap />} title={t("empty")} description={t("emptyHint")} />
    </div>
  );
}
