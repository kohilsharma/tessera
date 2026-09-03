import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ThemeSync } from "./components/ThemeSync";
import { queryClient } from "./queryClient";
import { applyTheme, readModeHint } from "./theme";
import { roleFromToken } from "./auth/token";
import "./tokens.css";
import "./styles.css";

// Before the first paint, not in an effect after it: index.html ships
// data-theme="newsroom", so a signed-in Investor whose theme were applied on mount
// would see one frame of the wrong product — and a dark-mode reader one frame of
// cream. Both values are local (the JWT, a hint), so this costs no round trip.
applyTheme(roleFromToken(), readModeHint());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
