import { open } from "@tauri-apps/plugin-dialog";
import { useUi } from "../store/uiStore";
import { useVault } from "../store/vaultStore";
import { freshNotes, GRAPH_NAME, useWorkspace } from "../store/workspaceStore";
import { importImage } from "./assets";
import { canvasDrops, editors, insertAtCursor, insertBlock } from "./editorRegistry";
import { isImagePath } from "./images";
import { errorMessage, validateName } from "./vault";

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

  /**
   * Opens the link map as a tab on the left, with the item you were on beside
   * it so nodes you click open there. Your other tabs stay open.
   */
  openLinkMap() {
    const ws = useWorkspace.getState();
    const graph = { kind: "graph", name: GRAPH_NAME } as const;
    if (ws.tabs.some((t) => t.items.some((i) => i.kind === "graph"))) return ws.open(graph);
    const keep = ws.panes[ws.focused];
    ws.open(graph, { pane: 0 });
    // Not split yet: move what you were looking at to the right of the map.
    if (keep && !ws.panes[1]) {
      const left = useWorkspace.getState().tabs[0].items;
      const at = left.findIndex((i) => i.kind === keep.kind && i.name === keep.name);
      if (at !== -1) useWorkspace.getState().moveTab(0, at, 1, 0);
      useWorkspace.getState().focus(0);
    }
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

  /** Flashcard review of the notebook's highlights (or one PDF's). */
  review(pdf: string | null = null) {
    if (!useVault.getState().activeNotebook) return;
    useUi.setState({ review: { pdf }, palette: null });
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

  /**
   * Files dropped onto the window (`at` in CSS pixels): images go into the note
   * under the pointer (or the focused note), PDFs are imported.
   */
  async dropFiles(paths: string[], at?: { x: number; y: number }) {
    const images = paths.filter(isImagePath);
    const pdfs = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
    if (images.length) await dropImages(images, at);
    if (pdfs.length) await actions.importPaths(pdfs);
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

/** The open note editor under a point, else the focused one, else any. */
function noteEditorAt(at?: { x: number; y: number }) {
  const under = at && document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-pane]");
  const hit = under ? editors.get(Number(under.dataset.pane) as 0 | 1) : undefined;
  return hit ?? editors.get(useWorkspace.getState().focused) ?? [...editors.values()][0];
}

async function dropImages(paths: string[], at?: { x: number; y: number }) {
  const notebook = useVault.getState().activeNotebook;
  // Onto a canvas: the images become cards where they were dropped.
  const pane = at && document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-pane]");
  const canvas = pane ? canvasDrops.get(Number(pane.dataset.pane) as 0 | 1) : undefined;
  if (canvas && pane?.querySelector(".cv")) return canvas(paths, at);
  const view = noteEditorAt(at);
  if (!notebook || !view) return useUi.getState().toast("Open a note to add images to it");
  try {
    const md: string[] = [];
    for (const p of paths) md.push(await importImage(notebook, p));
    const pos = at ? (view.posAtCoords(at) ?? undefined) : undefined;
    insertBlock(view, md.join("\n"), pos);
  } catch (e) {
    useUi.getState().toast(errorMessage(e), "error");
  }
}
