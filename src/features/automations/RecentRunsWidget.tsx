// Dashboard widget: latest automation runs.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAutomationRuns, useAutomations, useRecordLabel } from "../../app/CrmDataContext";
import { Badge, Card } from "../../components/ui";
import { intlLocale } from "../../i18n";
import { formatRelative } from "../../shared/lib/utils";
import { statusColor } from "./labels";

export function RecentRunsWidget() {
  const { t } = useTranslation("automations");
  const runs = useAutomationRuns();
  const automations = useAutomations();
  const recordLabel = useRecordLabel();
  const latest = [...runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, 6);
  return (
    <Card
      title={t("widget.title")}
      actions={
        <Link to="/automations/runs" className="text-xs text-surface-500 hover:underline">
          {t("widget.viewAll")}
        </Link>
      }
    >
      {latest.length === 0 ? (
        <p className="text-sm text-surface-500">{t("widget.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {latest.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <Badge color={statusColor(r.status)} dot>
                {t(`runs.statuses.${r.status}`)}
              </Badge>
              <span className="min-w-0 flex-1 truncate">
                {automations.find((a) => a.id === r.automationId)?.name ?? t("runs.deletedAutomation")}
                {r.recordId && <span className="text-surface-500"> · {recordLabel(r.recordId) ?? r.recordId}</span>}
              </span>
              <span className="shrink-0 text-xs text-surface-400">{formatRelative(r.startedAt, intlLocale())}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
