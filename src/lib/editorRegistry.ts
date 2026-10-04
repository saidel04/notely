import type { EditorView } from "@codemirror/view";

/** Open note editors by pane, so commands can insert text at the cursor. */
export const editors = new Map<0 | 1, EditorView>();

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
