// Integrations (owned by the automations / forms / integrations agent):
// Gmail / Google Calendar / Outlook via browser OAuth, email logging,
// meeting sync. Contributes UI through slots only (recordDetailTabs,
// recordDetailPanels, recordActions, settingsSections). PLACEHOLDER.
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";

const feature: Feature = {
  id: "integrations",
  routes: [],
  i18n: { en, fr },
  slots: {},
};

export default feature;
