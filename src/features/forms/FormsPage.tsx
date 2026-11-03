import { useTranslation } from "react-i18next";
import { FileInput } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/ui";

export function FormsPage() {
  const { t } = useTranslation("forms");
  return (
    <div>
      <PageHeader title={t("title")} icon={<FileInput />} />
      <EmptyState className="py-24" icon={<FileInput />} title={t("empty")} description={t("emptyHint")} />
    </div>
  );
}
