// Setup feature (backends + setup + roles agent): the setup wizard shown
// while the admin is not configured (Terms → Data → Location → Admin
// hosting → Workspace → Install, mirroring cms-ia SetupForm), the
// `loginScreen` slot (Firebase sign-in, git token, journal access on a
// new browser) and three Settings sections (Data backend, Admin hosting,
// Security).
import { createElement } from "react";
import { Database, Globe, ShieldCheck } from "lucide-react";
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { SetupWizard } from "./SetupWizard";
import { AccessScreen } from "./access/AccessScreen";
import { DataBackendSection } from "./settings/DataBackendSection";
import { AdminHostingSection } from "./settings/AdminHostingSection";
import { SecuritySection } from "./settings/SecuritySection";

const feature: Feature = {
  id: "setup",
  module: moduleMeta("setup"),
  routes: [],
  unconfiguredRoutes: [{ path: "*", element: createElement(SetupWizard) }],
  i18n: { en, fr },
  slots: {
    loginScreen: AccessScreen,
    settingsSections: [
      { id: "data-backend", label: "setup:settings.sections.data", icon: Database, order: 80, roles: ["admin"], component: DataBackendSection },
      { id: "admin-hosting", label: "setup:settings.sections.hosting", icon: Globe, order: 85, roles: ["admin"], component: AdminHostingSection },
      { id: "security", label: "setup:settings.sections.security", icon: ShieldCheck, order: 90, component: SecuritySection },
    ],
  },
};

export default feature;
