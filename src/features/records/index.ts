// Records feature (admin UI): object list pages (table / kanban, saved
// views, filters, bulk actions), record detail page (fields, timeline,
// notes, tasks, related records, slot tabs), trash, and the global
// quick-create / log-activity overlays ("record.create", "activity.log").
import { createElement } from "react";
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { ObjectListPage } from "./ObjectListPage";
import { RecordPage } from "./RecordPage";
import { TrashPage } from "./trash/TrashPage";
import { LogActivityHost, QuickCreateHost } from "./create/Overlays";

const feature: Feature = {
  id: "records",
  module: moduleMeta("records"),
  routes: [
    { path: "/objects/:objectId", element: createElement(ObjectListPage) },
    { path: "/objects/:objectId/trash", element: createElement(TrashPage) },
    { path: "/objects/:objectId/:recordId", element: createElement(RecordPage) },
  ],
  i18n: { en, fr },
  slots: { globalOverlays: [QuickCreateHost, LogActivityHost] },
};

export default feature;
