import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "./styles/index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useUi } from "./store/uiStore";
import { useVault } from "./store/vaultStore";
import { checkForUpdatesSoon } from "./lib/updates";

// Block the WebView's own context menu; the app provides its own where useful.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea, .cm-content")) e.preventDefault();
});

if (import.meta.env.DEV) {
  void Promise.all([
    import("./store/workspaceStore"),
    import("./store/highlightStore"),
    import("./store/linkIndex"),
    import("./store/canvasStore"),
    import("./store/reviewStore"),
    import("./store/deckStore"),
  ]).then(([ws, hl, li, cv, rv, dk]) => {
    Object.assign(window, {
      __notely: {
        useVault,
        useUi,
        useWorkspace: ws.useWorkspace,
        useHighlights: hl.useHighlights,
        useLinkIndex: li.useLinkIndex,
        useCanvases: cv.useCanvases,
        useReview: rv.useReview,
        useDecks: dk.useDecks,
      },
    });
  });
}

void (async () => {
  await useUi.getState().init();
  await useVault.getState().init();
  checkForUpdatesSoon();
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
