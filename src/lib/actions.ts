import { open } from "@tauri-apps/plugin-dialog";
import { useUi } from "../store/uiStore";
import { useVault } from "../store/vaultStore";
import { freshNotes, GRAPH_NAME, useWorkspace } from "../store/workspaceStore";
import { insertAtCursor } from "./editorRegistry";
import { validateName } from "./vault";

/** User-level commands shared by shortcuts, menus and the command palette. */
export const actions = {
  async newNote(side = false) {
    const name = await useVault.getState().createNote("Untitled");
    if (!name) return;
    freshNotes.add(name);
    const ws = useWorkspace.getState();
    // While reading a PDF, a new note opens beside it rather than replacing it.
    if (ws.panes[ws.focused]?.kind === "pdf") side = true;
    ws.open({ kind: "note", name }, side ? { side: true } : {});
  },

  async newNotebook() {
    const name = await useUi.getState().ask({
      title: "New notebook",
      placeholder: "e.g. Biology 101",
      validate: validateName,
    });
    if (name) await useVault.getState().createNotebook(name);
  },

  async renameNotebook(current: string) {
    const name = await useUi.getState().ask({
      title: "Rename notebook",
      initial: current,
      confirmLabel: "Rename",
      validate: validateName,
    });
    if (name) await useVault.getState().renameNotebook(current, name);
  },

  /** Opens the link map on the left, keeping the focused item beside it so clicked nodes open there. */
  openLinkMap() {
    const ws = useWorkspace.getState();
    const existing = ws.panes.findIndex((p) => p?.kind === "graph");
    if (existing !== -1) return ws.focus(existing as 0 | 1);
    const keep = ws.panes[ws.focused] ?? ws.panes[0];
    ws.setLayout([{ kind: "graph", name: GRAPH_NAME }, keep], 0);
  },

  async newCanvas(side = false) {
    const name = await useVault.getState().createCanvas("Untitled canvas");
    if (!name) return null;
    useWorkspace.getState().open({ kind: "canvas", name }, side ? { side: true } : {});
    return name;
  },

  /** Creates a canvas, embeds it at the cursor of the focused note, and opens it beside. */
  async insertCanvasIntoNote() {
    const ws = useWorkspace.getState();
    const pane = ws.focused;
    if (ws.panes[pane]?.kind !== "note") return useUi.getState().toast("Open a note first", "error");
    const name = await useVault.getState().createCanvas("Untitled canvas");
    if (!name) return;
    insertAtCursor(pane, `![[${name}.canvas]]`, true);
    useWorkspace.getState().open({ kind: "canvas", name }, { pane: pane === 0 ? 1 : 0 });
  },

  searchNotebook() {
    useUi.getState().openPalette("search");
  },

  async importPdf() {
    if (!useVault.getState().activeNotebook) return;
    const picked = await open({
      multiple: true,
      title: "Import PDFs",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!picked) return;
    await actions.importPaths(Array.isArray(picked) ? picked : [picked]);
  },

  async importPaths(paths: string[]) {
    const names = await useVault.getState().importPdfs(paths);
    if (names.length) useWorkspace.getState().open({ kind: "pdf", name: names[names.length - 1] });
  },

  async chooseVault() {
    const dir = await open({ directory: true, title: "Choose a folder for your notes" });
    if (typeof dir === "string") {
      try {
        await useVault.getState().openVault(dir);
      } catch (e) {
        useUi.getState().toast(String(e), "error");
      }
    }
  },
};
