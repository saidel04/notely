import type { EditorView } from "@codemirror/view";

/** Open note editors by pane, so commands can insert text at the cursor. */
export const editors = new Map<0 | 1, EditorView>();

/**
 * "Find in note" for each open note editor. Registered by the editor so global
 * shortcuts can open it without importing CodeMirror into the main bundle.
 */
export const finders = new Map<0 | 1, () => void>();

/** Open canvases by pane: image files dropped from Explorer onto one land there. */
export const canvasDrops = new Map<0 | 1, (paths: string[], at?: { x: number; y: number }) => Promise<void>>();

export function insertAtCursor(pane: 0 | 1, text: string, ownLine = false) {
  const view = editors.get(pane);
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  let insert = text;
  if (ownLine) {
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from).trim() ? "\n\n" : "";
    insert = `${before}${text}\n`;
  }
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
  view.focus();
  return true;
}

/**
 * Inserts `text` as its own block at the line containing `pos`: on that line if
 * it's empty, otherwise on a new line after it. Used for images and figures,
 * which only render when they sit alone on a line.
 */
export function insertBlock(view: EditorView, text: string, pos = view.state.selection.main.head) {
  const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
  const blank = !line.text.trim();
  const at = blank ? line.from : line.to;
  const insert = `${blank ? "" : "\n"}${text}\n`;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}
