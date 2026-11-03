// First import: publishes the extension runtime (React, the store hooks,
// the UI kit, src/ops…) on globalThis.__AGENTCRM_RUNTIME__ before any
// external bundle can be imported (src/extensions/runtime.ts).
import "./extensions/runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./app/App";
import { registerFeatures } from "./app/featureRegistry";
import { trackSafeModeKey } from "./extensions/loader";
import { FEATURES } from "./features";

// Holding Shift while the admin loads = safe mode (no external extension).
trackSafeModeKey();
registerFeatures(FEATURES);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
