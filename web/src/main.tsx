import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { applyStoredThemeOnLoad } from "./lib/theme.ts";
import "./tokens.css";

// UX-DR27: apply a persisted theme override before first paint so there is
// no flash of the OS-default theme when Spencer has chosen the other one.
applyStoredThemeOnLoad();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
