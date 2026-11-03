// Midnight — example theme package. A theme is an appearance preset
// (any subset of the workspace appearance) plus optional CSS (style.css,
// injected while the theme is selected). Users can still override any
// value in Settings → Appearance.
import { defineTheme } from "@agent-crm/runtime";

export default defineTheme({
  id: "midnight",
  apiVersion: "1.0.0",
  name: "Midnight",
  description: "Violet accent, slate grays, dark sidebar, dark mode by default.",
  appearance: { accent: "#7c3aed", neutral: "slate", radius: "lg", density: "comfortable", sidebar: "dark", defaultMode: "dark", buttons: "accent", contrast: "normal" },
});
