// AI assistant: a chat panel driving src/ai/tools.ts with the Claude API
// (the user's own key, kept in this browser; calls go straight from the
// browser to Anthropic). Runtime: src/ai/assistant/ (pure TS).
//   globalOverlays   → slide-over chat panel (⌘/Ctrl+J, "assistant.toggle", "assistant.ask")
//   topBar           → Sparkles toggle button
//   recordActions    → "Ask AI" (opens the panel with the record in context)
//   settingsSections → Settings → AI assistant (API key, model, max tokens)
import { Sparkles } from "lucide-react";
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { AssistantPanel } from "./AssistantPanel";
import { AssistantToggle } from "./AssistantToggle";
import { AssistantSettingsSection } from "./AssistantSettingsSection";
import { askAssistant } from "./events";

const feature: Feature = {
  id: "assistant",
  module: moduleMeta("assistant"),
  routes: [],
  i18n: { en, fr },
  slots: {
    globalOverlays: [AssistantPanel],
    topBar: [AssistantToggle],
    recordActions: [
      {
        id: "assistant.ask",
        label: "assistant:askAi",
        icon: Sparkles,
        order: 90,
        onSelect: ({ record, object }) => askAssistant({ objectId: object.id, recordId: record.id }),
      },
    ],
    settingsSections: [{ id: "assistant", label: "assistant:settings.title", icon: Sparkles, order: 60, component: AssistantSettingsSection }],
  },
};

export default feature;
