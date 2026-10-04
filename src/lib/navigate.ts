import { useUi } from "../store/uiStore";
import { findNotebook, useVault } from "../store/vaultStore";
import { nextNonce, PaneIndex, PaneItem, useWorkspace } from "../store/workspaceStore";
import { isCanvasName, isPdfName, sameName, splitTarget, WikiLink } from "./links";

const otherPane = (p: PaneIndex): PaneIndex => (p === 0 ? 1 : 0);

export interface ItemRef {
  notebook: string;
  name: string;
  kind: "note" | "pdf" | "canvas";
  /** True when the item is in the active notebook. */
  local: boolean;
}

function notebookNamed(name: string | null) {
  const { notebooks, activeNotebook } = useVault.getState();
  if (!name) return findNotebook(activeNotebook);
  return notebooks.find((n) => sameName(n.name, name)) ?? null;
}

/**
 * Resolves a link target — "Note", "paper.pdf", "Flow.canvas", or any of those
 * prefixed with "Notebook/" — to an existing item, case-insensitively.
 */
export function resolveRef(target: string, kind?: ItemRef["kind"]): ItemRef | null {
  const { notebook, name } = splitTarget(target);
  const nb = notebookNamed(notebook);
  if (!nb) return null;
  const k = kind ?? (isPdfName(name) ? "pdf" : isCanvasName(name) ? "canvas" : "note");
  const wanted = k === "canvas" ? name.replace(/\.canvas$/i, "") : name;
  const list = k === "note" ? nb.notes : k === "pdf" ? nb.pdfs : nb.canvases;
  const hit = list.find((i) => sameName(i.name, wanted));
  if (!hit) return null;
  return { notebook: nb.name, name: hit.name, kind: k, local: nb.name === useVault.getState().activeNotebook };
}

// Active-notebook lookups (null for items elsewhere).
const localName = (r: ItemRef | null) => (r?.local ? r.name : null);
export const resolveNote = (target: string) => localName(resolveRef(target, "note"));
export const resolveCanvas = (target: string) => localName(resolveRef(target, "canvas"));
export const resolvePdf = (target: string) => localName(resolveRef(target, "pdf"));

/** Switches notebook when needed, then opens the item. */
async function openIn(notebook: string, item: PaneItem, opts: { pane?: PaneIndex; side?: boolean }) {
  if (notebook !== useVault.getState().activeNotebook) {
    await useVault.getState().setActiveNotebook(notebook);
    useUi.getState().toast(`Opened in “${notebook}”`);
    return useWorkspace.getState().open(item);
  }
  useWorkspace.getState().open(item, opts);
}

/**
 * Follows a wiki link clicked in pane `from`.
 * PDFs and canvases open beside the note so you can work side by side; notes
 * replace the current pane unless `side` (Ctrl+click) is set. Links into other
 * notebooks switch to that notebook.
 */
export async function followLink(link: WikiLink, from: PaneIndex, side = false) {
  const vault = useVault.getState();
  const ref = resolveRef(link.target, link.kind);

  if (link.kind === "pdf") {
    if (!ref) return useUi.getState().toast(`Can't find “${link.target}”`, "error");
    const target = {
      page: link.page ?? undefined,
      highlightId: link.highlightId ?? undefined,
      bookmarkId: link.bookmarkId ?? undefined,
      nonce: nextNonce(),
    };
    return openIn(ref.notebook, { kind: "pdf", name: ref.name, target }, { pane: otherPane(from) });
  }

  // Missing notes/canvases are created (in the linked notebook) when clicked.
  let found = ref;
  if (!found) {
    const nb = link.notebook ? notebookNamed(link.notebook) : findNotebook(vault.activeNotebook);
    if (!nb) return useUi.getState().toast(`There's no notebook “${link.notebook}”`, "error");
    if (nb.name !== vault.activeNotebook) await vault.setActiveNotebook(nb.name);
    const name =
      link.kind === "canvas"
        ? await useVault.getState().createCanvas(link.name.replace(/\.canvas$/i, ""))
        : await useVault.getState().createNote(link.name);
    if (!name) return;
    found = { notebook: nb.name, name, kind: link.kind, local: true };
  }

  if (link.kind === "canvas") {
    return openIn(found.notebook, { kind: "canvas", name: found.name }, side ? { pane: from } : { pane: otherPane(from) });
  }
  return openIn(found.notebook, { kind: "note", name: found.name }, side ? { side: true } : { pane: from });
}

export function openPdfPage(name: string, page: number, highlightId?: string) {
  useWorkspace.getState().open({ kind: "pdf", name, target: { page, highlightId, nonce: nextNonce() } });
}
