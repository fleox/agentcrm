import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Tabs } from "../../components/ui";

export function FormsTabs({ value }: { value: "list" | "inbox" }) {
  const { t } = useTranslation("forms");
  const navigate = useNavigate();
  return (
    <div className="px-4">
      <Tabs
        value={value}
        onChange={(id) => navigate(id === "inbox" ? "/forms/inbox" : "/forms")}
        tabs={[
          { id: "list", label: t("tabs.list") },
          { id: "inbox", label: t("tabs.inbox") },
        ]}
      />
    </div>
  );
}
