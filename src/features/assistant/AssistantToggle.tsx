// Top bar button (topBar slot) toggling the assistant panel.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { IconButton } from "../../components/ui";
import { emitShellEvent, useShellEvent } from "../../app/shellEvents";
import { ASSISTANT_TOGGLE, ASSISTANT_VISIBILITY } from "./events";

export function AssistantToggle() {
  const { t } = useTranslation("assistant");
  const [open, setOpen] = useState(false);
  useShellEvent(ASSISTANT_VISIBILITY, (d) => setOpen(!!(d as { open?: boolean } | undefined)?.open));
  return <IconButton label={t("toggle")} icon={<Sparkles />} active={open} aria-pressed={open} onClick={() => emitShellEvent(ASSISTANT_TOGGLE)} />;
}
