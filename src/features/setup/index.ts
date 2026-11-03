// Setup wizard (owned by the backend agent: Terms → Data → Where →
// Install, mirroring cms-ia SetupForm). PLACEHOLDER: lets a developer pick
// "This browser (local)" and seed demo data so `npm run dev` works.
// The backend agent also provides the `loginScreen` slot here (Firebase /
// git-json sign-in).
import { createElement } from "react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { SetupPlaceholder } from "./SetupPlaceholder";

const feature: Feature = {
  id: "setup",
  routes: [],
  unconfiguredRoutes: [{ path: "*", element: createElement(SetupPlaceholder) }],
  i18n: { en, fr },
  slots: {},
};

export default feature;
