import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/sora";
import "@fontsource-variable/fraunces/wght-italic.css";
import "@fontsource-variable/caveat";
import "./index.css";
import { ToastProvider } from "./app/toast";
import { AppProvider } from "./app/AppContext";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { App } from "./App";
import { reloadForUpdate } from "./app/staleChunk";

// En sidfil från den förra versionen gick inte att hämta (ny version publicerad): ladda om en gång
window.addEventListener("vite:preloadError", (e) => { if (reloadForUpdate()) e.preventDefault(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <AppProvider>
            <App />
          </AppProvider>
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
