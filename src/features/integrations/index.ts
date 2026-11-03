// Integrations feature: Gmail / Google Calendar / Outlook via browser
// OAuth (no server), email logging and meeting sync. Engine:
// src/ops/integrations/. Contributes UI through slots only.
//
// Storage: client ids / tenant / toggles per browser in localStorage
// (`agentcrm.integrations.settings`, optionally shared with the team via
// the public `config/integrations` doc); OAuth tokens in sessionStorage
// only. See INTEGRATIONS.md.
import { Mail, Plug } from "lucide-react";
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { handleOAuthPopupCallback } from "./auth";
import { AutoSync } from "./AutoSync";
import { EmailsTab } from "./EmailsTab";
import { MeetingsPanel } from "./MeetingsPanel";
import { IntegrationsSettingsSection } from "./SettingsSection";

// In the Microsoft sign-in popup (back on the admin URL with
// ?code&state): hand the code to the opener and close. A no-op in every
// other window, so the app boots normally.
handleOAuthPopupCallback();

const contactObjects = (o: { id: string }) => o.id === "people" || o.id === "companies";

const feature: Feature = {
  id: "integrations",
  module: moduleMeta("integrations"),
  routes: [],
  i18n: { en, fr },
  slots: {
    settingsSections: [{ id: "integrations", label: "integrations:title", icon: Plug, order: 40, component: IntegrationsSettingsSection }],
    recordDetailTabs: [{ id: "emails", label: "integrations:emails.tab", icon: Mail, order: 30, component: EmailsTab, when: contactObjects }],
    recordDetailPanels: [{ id: "upcoming-meetings", order: 30, component: MeetingsPanel, when: contactObjects }],
    globalOverlays: [AutoSync],
  },
};

export default feature;
