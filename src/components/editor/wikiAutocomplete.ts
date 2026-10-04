import { Completion, CompletionContext, CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { Bookmark, Highlight } from "../../store/highlightStore";

export interface WikiSource {
  notes(): string[];
  pdfs(): string[];
  canvases(): string[];
  /** Other notebooks, offered as "Name/" prefixes. */
  notebooks(): string[];
  itemsIn(notebook: string): { notebook: string; notes: string[]; pdfs: string[]; canvases: string[] } | null;
  /** Highlights of a PDF (resolved case-insensitively), loading them if needed. */
  highlights(pdf: string): Promise<{ pdf: string; list: Highlight[]; bookmarks: Bookmark[] } | null>;
}

/**
 * Inserts `text`, adds the closing `]]` unless one is already there, and puts the cursor after it.
 * `replaceFrom` widens the replaced range (e.g. to swap a typed "Notebook/" prefix for the canonical one).
 */
function applyLink(text: string, replaceFrom?: number) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    if (replaceFrom !== undefined) from = replaceFrom;
    const hasClose = view.state.sliceDoc(to, to + 2) === "]]";
    const insert = hasClose ? text : text + "]]";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + text.length + 2 },
      userEvent: "input.complete",
    });
  };
}

/** `#ta…` → existing tags, most used first. */
export function tagCompletions(tags: () => { name: string; count: number }[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?:^|[\s(,;:])#[\p{L}_][\p{L}\p{N}_\-/]*$/u);
    if (!m) return null;
    const hash = m.text.indexOf("#");
    const list = tags();
    if (!list.length) return null;
    return {
      from: m.from + hash + 1,
      options: list.map((t) => ({ label: t.name, detail: `${t.count}`, type: "tag" })),
      validFor: /^[\p{L}\p{N}_\-/]*$/u,
    };
  };
}

const snippet = (t: string) => (t.length > 70 ? t.slice(0, 68).trimEnd() + "…" : t);

export function wikiCompletions(src: WikiSource) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.matchBefore(/\[\[[^[\]\n|]*$/);
    if (!before) return null;
    const inner = before.text.slice(2);
    const hash = inner.indexOf("#");

    const slash = inner.indexOf("/");
    if (hash === -1 && slash > 0) {
      // [[Notebook/… → items of that notebook
      const items = src.itemsIn(inner.slice(0, slash));
      if (!items) return null;
      return {
        from: before.from + 2 + slash + 1,
        options: [
          ...items.notes.map((n) => ({ label: n, detail: `note · ${items.notebook}`, apply: applyLink(`${items.notebook}/${n}`, before.from + 2) })),
          ...items.pdfs.map((p) => ({ label: p, detail: `pdf · ${items.notebook}`, apply: applyLink(`${items.notebook}/${p}`, before.from + 2) })),
          ...items.canvases.map((c) => ({ label: `${c}.canvas`, detail: `canvas · ${items.notebook}`, apply: applyLink(`${items.notebook}/${c}.canvas`, before.from + 2) })),
        ],
        validFor: /^[^[\]#|\n/]*$/,
      };
    }

    if (hash === -1) {
      const options: Completion[] = [
        ...src.notes().map((n) => ({ label: n, detail: "note", apply: applyLink(n), boost: 1 })),
        ...src.pdfs().map((p) => ({ label: p, detail: "pdf", apply: applyLink(p) })),
        ...src.canvases().map((c) => ({ label: `${c}.canvas`, detail: "canvas", apply: applyLink(`${c}.canvas`) })),
        // Other notebooks: picking one inserts "Name/" and lists its items.
        ...src.notebooks().map((nb) => ({
          label: `${nb}/`,
          detail: "notebook",
          boost: -1,
          apply: (view: EditorView, _c: Completion, from: number, to: number) => {
            view.dispatch({ changes: { from, to, insert: `${nb}/` }, selection: { anchor: from + nb.length + 1 } });
            startCompletion(view);
          },
        })),
      ];
      return { from: before.from + 2, options, validFor: /^[^[\]#|\n]*$/ };
    }

    const res = await src.highlights(inner.slice(0, hash).trim());
    if (!res) return null;
    const options: Completion[] = [
      { label: "page=", detail: "link to a page", apply: "page=", boost: 2 },
      ...res.bookmarks.map((b) => ({
        label: b.name,
        detail: `bookmark · p. ${b.page}`,
        apply: applyLink(b.id),
        boost: 1,
      })),
      ...res.list.map((h) => ({
        label: snippet(h.text.replace(/\s+/g, " ")),
        detail: `p. ${h.page}`,
        apply: applyLink(h.id),
      })),
    ];
    return { from: before.from + 2 + hash + 1, options };
  };
}
