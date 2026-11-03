// Deals & pipelines — an object module: it has no page of its own (the
// deals object is rendered by features/records); switching it off hides
// the deals object (navigation, list / kanban / record routes, pickers),
// the Pipelines settings section, the pipeline reports and the dashboard
// pipeline widgets. No data is deleted. See src/core/modules.ts.
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";

const feature: Feature = {
  id: "deals",
  module: moduleMeta("deals"),
  routes: [],
  i18n: { en, fr },
};

export default feature;
