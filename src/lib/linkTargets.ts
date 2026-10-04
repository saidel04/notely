import type { EditorView } from "@codemirror/view";
import { HIGHLIGHT_COLORS, useHighlights } from "../store/highlightStore";
import { findNotebook, useVault } from "../store/vaultStore";
import { formatLink } from "./links";

export interface LinkTarget {
  kind: "note" | "highlight" | "bookmark" | "pdf" | "canvas";
  /** What the picker shows. */
  label: string;
  /** Secondary text (PDF title + page for highlights). */
  detail?: string;
  target: string;
  fragment?: string;
  color?: (typeof HIGHLIGHT_COLORS)[number];
}

/** Everything in the notebook a link can point to, highlights included. */
export async function collectTargets(notebook: string, exceptNote?: string): Promise<LinkTarget[]> {
  const nb = findNotebook(notebook);
  if (!nb) return [];
  const out: LinkTarget[] = nb.notes.filter((n) => n.name !== exceptNote).map((n) => ({ kind: "note", label: n.name, target: n.name }));
  const hl = useHighlights.getState();
  for (const p of nb.pdfs) {
    const title = p.name.replace(/\.pdf$/i, "");
    for (const h of await hl.ensure(notebook, p.name)) {
      out.push({ kind: "highlight", label: h.text, detail: `${title} · p. ${h.page}`, target: p.name, fragment: h.id, color: h.color });
    }
    for (const b of await hl.ensureBookmarks(notebook, p.name)) {
      out.push({ kind: "bookmark", label: b.name, detail: `${title} · p. ${b.page}`, target: p.name, fragment: b.id });
    }
  }
  nb.pdfs.forEach((p) => out.push({ kind: "pdf", label: p.name.replace(/\.pdf$/i, ""), target: p.name }));
  nb.canvases.forEach((c) => out.push({ kind: "canvas", label: c.name, target: `${c.name}.canvas` }));
  // Other notebooks (links get a "Notebook/" prefix).
  for (const other of useVault.getState().notebooks) {
    if (other.name === notebook) continue;
    const at = `in ${other.name}`;
    other.notes.forEach((n) => out.push({ kind: "note", label: n.name, detail: at, target: `${other.name}/${n.name}` }));
    other.pdfs.forEach((p) => out.push({ kind: "pdf", label: p.name.replace(/\.pdf$/i, ""), detail: at, target: `${other.name}/${p.name}` }));
    other.canvases.forEach((c) => out.push({ kind: "canvas", label: c.name, detail: at, target: `${other.name}/${c.name}.canvas` }));
  }
  return out;
}

/** Link text is shown inside `[[…|text]]`, which can't contain brackets, pipes or newlines. */
const cleanAlias = (s: string) => s.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim();

/**
 * Turns the selection into a link with the selected words as its text
 * (or inserts a plain link when nothing is selected).
 */
export function linkSelection(view: EditorView, target: string, fragment?: string | null) {
  const { from, to } = view.state.selection.main;
  const alias = cleanAlias(view.state.sliceDoc(from, to));
  const insert = formatLink(target, fragment, alias || null);
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.link" });
  view.focus();
}
