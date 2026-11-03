import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Tabs } from "../../components/ui";

export function AutomationsTabs({ value }: { value: "list" | "runs" | "templates" }) {
  const { t } = useTranslation("automations");
  const navigate = useNavigate();
  const to = { list: "/automations", runs: "/automations/runs", templates: "/automations/templates" } as const;
  return (
    <div className="px-4">
      <Tabs
        value={value}
        onChange={(id) => navigate(to[id as keyof typeof to])}
        tabs={[
          { id: "list", label: t("tabs.list") },
          { id: "runs", label: t("tabs.runs") },
          { id: "templates", label: t("tabs.templates") },
        ]}
      />
    </div>
  );
}
