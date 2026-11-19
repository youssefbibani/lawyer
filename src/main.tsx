import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.tsx";
import { applyAccent, applyFontSize, applyTheme, getStoredAccent, getStoredFontSize, getStoredTheme } from "./lib/theme";

applyTheme(getStoredTheme());
applyFontSize(getStoredFontSize());
applyAccent(getStoredAccent());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
