import { useUi } from "../store/uiStore";
import { noteSaver } from "../store/vaultStore";
import { errorMessage } from "./vault";

// Auto-update: new versions are published as GitHub releases (signed; the app
// only accepts updates signed with Notely's key). The plugins are loaded on
// demand so they stay out of the startup bundle.

let busy = false;

/**
 * Looks for a newer version. Quiet mode (the startup check) says nothing unless
 * there is one; otherwise you're told the result.
 */
export async function checkForUpdates(quiet = false) {
  if (busy) return;
  busy = true;
  const ui = useUi.getState();
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      if (!quiet) ui.toast("Notely is up to date");
      return;
    }
    ui.toastAction(`Notely ${update.version} is available`, "Update", () => {
      void (async () => {
        try {
          ui.toast(`Downloading Notely ${update.version}…`);
          await noteSaver.flushAll(); // nothing unsaved is lost on restart
          await update.downloadAndInstall();
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch (e) {
          ui.toast(`Update failed: ${errorMessage(e)}`, "error");
        }
      })();
    });
  } catch (e) {
    if (!quiet) ui.toast(`Couldn't check for updates: ${errorMessage(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** Checks once, shortly after launch, in installed (production) builds only. */
export function checkForUpdatesSoon() {
  if (import.meta.env.DEV) return;
  window.setTimeout(() => void checkForUpdates(true), 8000);
}
