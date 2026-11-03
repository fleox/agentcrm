// Forms feature: lead capture form builder (fields, labels, required,
// success message, live preview), publish to the hosting target, embed
// snippet, inbox viewer with "Ingest now" and auto-ingestion while the
// admin is open. Engine: src/ops/forms.ts. Inbox setup: INBOX.md.
import { createElement } from "react";
import { FileInput } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { setInboxSourceResolver } from "../../ops/forms";
import { FormsPage } from "./FormsPage";
import { FormBuilderPage } from "./FormBuilder";
import { InboxPage } from "./InboxPage";
import { FormsRuntime } from "./FormsRuntime";
import { browserInboxSource } from "./inboxResolver";

const roles: ("admin" | "member")[] = ["admin", "member"];

const feature: Feature = {
  id: "forms",
  routes: [
    { path: "/forms", element: createElement(FormsPage), roles },
    { path: "/forms/inbox", element: createElement(InboxPage), roles },
    { path: "/forms/:formId", element: createElement(FormBuilderPage), roles },
  ],
  navItems: [{ id: "forms", label: "forms:nav.title", icon: FileInput, to: "/forms", section: "workspace", order: 20, roles }],
  i18n: { en, fr },
  slots: { globalOverlays: [FormsRuntime] },
  onStart: () => {
    setInboxSourceResolver((_ctx, form) => browserInboxSource(form));
    return () => setInboxSourceResolver(null);
  },
};

export default feature;
