import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.tsx";
import { applyFontSize, applyTheme, getStoredFontSize, getStoredTheme } from "./lib/theme";

applyTheme(getStoredTheme());
applyFontSize(getStoredFontSize());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
