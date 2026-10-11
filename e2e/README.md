# End-to-end smoke tests

These drive the **running sandbox app** through its stores and UI over the
WebView2 remote-debugging protocol (`playwright-core` → `connectOverCDP`). They
cover behaviours that unit tests can't reach — cross-notebook backlinks, canvas
undo, undo-delete.

They are **not** part of `npm test` and don't run in CI: they need the built
desktop app and a live WebView. Run them by hand before a release.

## Running

1. Launch the sandbox app with remote debugging enabled:

   ```sh
   # PowerShell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; npm run dev:sandbox

   # bash
   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run dev:sandbox
   ```

   Pick a scratch vault whose path contains `DevVault` on first launch — the
   harness refuses to run against anything else, so your real notes are safe.

2. In another terminal, run the specs:

   ```sh
   node e2e/run.mjs              # all specs
   node e2e/run.mjs canvasUndo   # just the ones whose name matches
   ```

   Override the debugging endpoint with `NOTELY_CDP` if you used another port.

The runner exits non-zero if any check fails.

## Notes

- `window.__notely` exposes the Zustand stores (`useVault`, `useUi`,
  `useWorkspace`, `useHighlights`, `useLinkIndex`, `useCanvases`) in dev builds
  only — see `src/main.tsx`.
- Each spec is an ES module exporting `name` and `run(ctx)`; add one to the
  `ALL` array in `run.mjs`.
