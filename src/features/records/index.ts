// Records feature (owned by the admin UI agent): object list pages
// (table / kanban, saved views, bulk actions) and the record detail page.
// PLACEHOLDER pages for now — replace freely inside this folder.
import { createElement } from "react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { ObjectListPage } from "./ObjectListPage";
import { RecordPage } from "./RecordPage";

const feature: Feature = {
  id: "records",
  routes: [
    { path: "/objects/:objectId", element: createElement(ObjectListPage) },
    { path: "/objects/:objectId/:recordId", element: createElement(RecordPage) },
  ],
  i18n: { en, fr },
};

export default feature;
