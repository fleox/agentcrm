// AI assistant (owned by the automations / forms / integrations agent):
// a chat panel driving src/ai/tools.ts with the Claude API (the user's own
// key, kept in this browser). Mount the panel through `globalOverlays`,
// a toggle button through `topBar`, open it on the "assistant.toggle"
// shell event. PLACEHOLDER.
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";

const feature: Feature = {
  id: "assistant",
  routes: [],
  i18n: { en, fr },
  slots: {},
};

export default feature;
