import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Plug } from "lucide-react";
import { paths } from "../../app/paths";

// Compact "connect your mailbox" prompt linking to the settings section.
export function ConnectPrompt({ compact }: { compact?: boolean }) {
  const { t } = useTranslation("integrations");
  return (
    <div className={compact ? "text-sm text-surface-500" : "flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-surface-500"}>
      {!compact && (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 text-surface-500 dark:bg-surface-800">
          <Plug className="h-5 w-5" />
        </div>
      )}
      <p>{t("connect.prompt")}</p>
      <Link to={paths.settings("integrations")} className="font-medium text-accent-600 hover:underline dark:text-accent-400">
        {t("connect.link")}
      </Link>
    </div>
  );
}
