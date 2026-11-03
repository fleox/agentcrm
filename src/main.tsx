import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./app/App";
import { registerFeatures } from "./app/featureRegistry";
import { FEATURES } from "./features";

registerFeatures(FEATURES);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
