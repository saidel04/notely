import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ITEM_MIME, QUOTE_MIME, quoteMarkdown } from "../../lib/dragQuote";
import { formatLink, parseCopiedLink, WikiLink } from "../../lib/links";
import { editors } from "../../lib/editorRegistry";
import { linkSelection } from "../../lib/linkTargets";
import { followLink, resolveRef } from "../../lib/navigate";
import { vaultApi } from "../../lib/vault";
import { hlKey, useHighlights } from "../../store/highlightStore";
import { useUi } from "../../store/uiStore";
import { findNotebook, noteSaver, useVault } from "../../store/vaultStore";
import { freshNotes, NoteTarget, PaneIndex } from "../../store/workspaceStore";
import { Backlinks } from "./Backlinks";
import { canvasEmbeds } from "./embeds";
import { LinkHoverCard } from "./LinkHoverCard";
import { LinkPicker } from "./LinkPicker";
import { livePreview, refreshPreview } from "./livePreview";
import { tagCompletions, wikiCompletions } from "./wikiAutocomplete";
import { buildTagIndex } from "../../store/tagIndex";
import { useCanvases } from "../../store/canvasStore";

/** Marks transactions that sync content from disk, so they aren't saved back. */
const external = Annotation.define<boolean>();

function wrap(marker: string) {
  return (view: EditorView) => {
    view.dispatch(
      view.state.changeByRange((r) => {
        const text = view.state.sliceDoc(r.from, r.to);
        return {
          changes: { from: r.from, to: r.to, insert: marker + text + marker },
          range: EditorSelection.range(r.from + marker.length, r.to + marker.length),
        };
      }),
    );
    return true;
  };
}

/** Replaces only the differing middle of the document so the cursor survives external edits. */
function syncDoc(view: EditorView, next: string) {
  const cur = view.state.doc.toString();
  if (cur === next) return;
  let start = 0;
  while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
    endCur--;
    endNext--;
  }
  view.dispatch({
    changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
    annotations: [external.of(true)],
  });
}

export function NoteEditor({
  notebook,
  note,
  pane,
  target,
}: {
  notebook: string;
  note: string;
  pane: PaneIndex;
  target?: NoteTarget;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorFont = useUi((s) => s.editorFont);
  const targetRef = useRef(target);
  targetRef.current = target;
  const appliedTarget = useRef<number | null>(null);

  // ---------- linking selected text ----------
  const [hover, setHover] = useState<{ link: WikiLink; rect: DOMRect } | null>(null);
  const hoverTimer = useRef(0);
  /** Small "Link" button floating over a selection. */
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; text: string } | null>(null);

  const onHover = (link: WikiLink | null, rect?: DOMRect) => {
    window.clearTimeout(hoverTimer.current);
    if (!link || !rect) return setHover(null);
    hoverTimer.current = window.setTimeout(() => setHover({ link, rect }), 350);
  };

  const openPicker = () => {
    const v = viewRef.current;
    if (!v) return false;
    const { from, to } = v.state.selection.main;
    const c = v.coordsAtPos(to) ?? v.coordsAtPos(from);
    if (!c) return false;
    setBubble(null);
    setPicker({ x: c.left, y: c.bottom + 8, text: v.state.sliceDoc(from, to).replace(/\s+/g, " ").trim() });
    return true;
  };

  const updateBubble = (view: EditorView) => {
    const { from, to, empty } = view.state.selection.main;
    const singleLine = view.state.doc.lineAt(from).number === view.state.doc.lineAt(to).number;
    // Only for plain words: skip selections that already contain a link.
    if (empty || !view.hasFocus || !singleLine || /\[\[|\]\]/.test(view.state.sliceDoc(from, to))) return setBubble(null);
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to);
    if (!a || !b) return setBubble(null);
    setBubble({ x: (a.left + b.right) / 2, y: Math.min(a.top, b.top) });
  };

  /** Selects and centers a search match (from notebook search). */
  const applyTarget = () => {
    const v = viewRef.current;
    const t = targetRef.current;
    if (!v || !t || appliedTarget.current === t.nonce) return;
    appliedTarget.current = t.nonce;
    const len = v.state.doc.length;
    const from = Math.min(t.from, len);
    const to = Math.min(t.to, len);
    v.focus();
    v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
  };
  useEffect(applyTarget, [target]);

  // ---------- editor lifecycle ----------
  useEffect(() => {
    let cancelled = false;
    let unsubs: (() => void)[] = [];

    (async () => {
      const cached = useVault.getState().contents[note];
      const doc = cached ?? (await vaultApi.readNote(notebook, note).catch(() => ""));
      if (cancelled || !host.current) return;

      const exists = (l: WikiLink) => !!resolveRef(l.target, l.kind);
      const highlightText = (l: WikiLink) => {
        const ref = resolveRef(l.target, "pdf");
        if (!ref) return undefined;
        const st = useHighlights.getState();
        const k = hlKey(ref.notebook, ref.name);
        if (l.bookmarkId) {
          const bms = st.bookmarks[k];
          if (!bms) void st.ensureBookmarks(ref.notebook, ref.name);
          return bms?.find((b) => b.id === l.bookmarkId)?.name;
        }
        const list = st.byPdf[k];
        if (!list) void st.ensure(ref.notebook, ref.name);
        return list?.find((h) => h.id === l.highlightId)?.text;
      };

      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc,
          extensions: [
            history(),
            drawSelection(),
            EditorView.lineWrapping,
            markdown({ base: markdownLanguage }),
            closeBrackets(),
            autocompletion({
              override: [
                wikiCompletions({
                  notes: () => findNotebook(notebook)?.notes.map((n) => n.name).filter((n) => n !== note) ?? [],
                  pdfs: () => findNotebook(notebook)?.pdfs.map((p) => p.name) ?? [],
                  canvases: () => findNotebook(notebook)?.canvases.map((c) => c.name) ?? [],
                  highlights: async (target) => {
                    const ref = resolveRef(target, "pdf");
                    if (!ref) return null;
                    const st = useHighlights.getState();
                    return { pdf: ref.name, list: await st.ensure(ref.notebook, ref.name), bookmarks: await st.ensureBookmarks(ref.notebook, ref.name) };
                  },
                  notebooks: () => useVault.getState().notebooks.map((n) => n.name).filter((n) => n !== notebook),
                  itemsIn: (nb) => {
                    const b = useVault.getState().notebooks.find((n) => n.name.toLowerCase() === nb.toLowerCase());
                    return b ? { notebook: b.name, notes: b.notes.map((n) => n.name), pdfs: b.pdfs.map((p) => p.name), canvases: b.canvases.map((c) => c.name) } : null;
                  },
                }),
                tagCompletions(() => {
                  const contents = useVault.getState().contents;
                  const index = buildTagIndex(contents, useCanvases.getState().data);
                  return index.map((t) => ({ name: t.name, count: t.notes.length + t.canvases.length }));
                }),
              ],
              icons: false,
            }),
            placeholder("Start writing…  Type [[ to link a note or PDF"),
            keymap.of([
              { key: "Mod-b", run: wrap("**") },
              { key: "Mod-i", run: wrap("*") },
              { key: "Mod-l", run: () => openPicker() },
              ...closeBracketsKeymap,
              ...completionKeymap,
              ...markdownKeymap,
              ...historyKeymap,
              ...defaultKeymap,
              indentWithTab,
            ]),
            livePreview({
              exists,
              highlightText,
              follow: (l, side) => void followLink(l, pane, side),
              hover: onHover,
              tag: (t) => useUi.setState({ tagFilter: t, sidebarOpen: true }),
            }),
            EditorView.domEventHandlers({
              // Paste a copied link onto selected words → the words become that link.
              paste(e, v) {
                const sel = v.state.selection.main;
                if (sel.empty) return false;
                const link = parseCopiedLink(e.clipboardData?.getData("text/plain") ?? "");
                if (!link || /\n/.test(v.state.sliceDoc(sel.from, sel.to))) return false;
                e.preventDefault();
                linkSelection(v, link.target, link.fragment);
                return true;
              },
              blur() {
                window.setTimeout(() => setBubble(null), 150);
                return false;
              },
              dragover(e) {
                const t = e.dataTransfer?.types ?? [];
                if (t.includes(QUOTE_MIME) || t.includes(ITEM_MIME)) e.preventDefault();
                return false;
              },
              // Quotes dragged from a PDF become cited blockquotes; sidebar items become links.
              drop(e, v) {
                const quote = e.dataTransfer?.getData(QUOTE_MIME);
                const item = e.dataTransfer?.getData(ITEM_MIME);
                if (!quote && !item) return false;
                e.preventDefault();
                const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
                let insert: string;
                if (quote) {
                  // A blockquote needs its own paragraph.
                  const line = v.state.doc.lineAt(pos);
                  const at = line.text.trim() ? line.to : line.from;
                  const before = at > 0 && v.state.doc.lineAt(at).text.trim() ? "\n\n" : "";
                  insert = `${before}${quoteMarkdown(JSON.parse(quote))}\n\n`;
                  v.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: "input.drop" });
                } else {
                  const it = JSON.parse(item!) as { kind: string; name: string };
                  insert = formatLink(it.kind === "canvas" ? `${it.name}.canvas` : it.name);
                  v.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: "input.drop" });
                }
                v.focus();
                return true;
              },
            }),
            canvasEmbeds({ notebook, resolve: (t) => resolveRef(t, "canvas"), open: (l, side) => void followLink(l, pane, side) }),
            EditorView.updateListener.of((u) => {
              if (u.selectionSet || u.focusChanged || u.docChanged || u.geometryChanged) updateBubble(u.view);
              if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
                noteSaver.schedule(notebook, note, u.state.doc.toString());
              }
            }),
            EditorView.contentAttributes.of({ spellcheck: "true" }),
          ],
        }),
      });
      viewRef.current = view;
      editors.set(pane, view);
      applyTarget();

      const refresh = () => view.dispatch({ effects: refreshPreview.of(null) });
      unsubs = [
        // External edits (watcher, link rewrites) flow into the open editor.
        useVault.subscribe((s, prev) => {
          const text = s.contents[note];
          if (text !== undefined && text !== prev.contents[note]) syncDoc(view, text);
          if (s.notebooks !== prev.notebooks) refresh();
        }),
        useHighlights.subscribe((s, prev) => s.byPdf !== prev.byPdf && refresh()),
      ];

      if (freshNotes.has(note)) {
        // Cleared a tick later so a StrictMode re-mount still sees it.
        window.setTimeout(() => freshNotes.delete(note));
        titleRef.current?.focus();
        titleRef.current?.select();
      } else if (useVault.getState().contents[note] === "") view.focus();
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      if (viewRef.current && editors.get(pane) === viewRef.current) editors.delete(pane);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [notebook, note, pane]);

  // ---------- title / rename ----------
  const [title, setTitle] = useState(note);
  useEffect(() => setTitle(note), [note]);

  const commitTitle = async () => {
    const next = title.trim();
    if (!next || next === note) return setTitle(note);
    const ok = await useVault.getState().renameNote(note, next);
    if (!ok) setTitle(note);
  };

  const focusEnd = () => {
    const v = viewRef.current;
    if (!v) return;
    v.focus();
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  };

  return (
    <div
      className="h-full overflow-y-auto"
      onScroll={() => {
        if (bubble) setBubble(null);
        if (hover) setHover(null);
      }}
      style={{ ["--editor-font" as string]: editorFont === "serif" ? "var(--font-serif)" : "var(--font-sans)" }}
    >
      <div className="mx-auto max-w-[720px] px-12 pt-14 pb-3">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              viewRef.current?.focus();
            } else if (e.key === "Escape") {
              setTitle(note);
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
          spellCheck={false}
          className="w-full bg-transparent text-[2rem] leading-tight font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-faint"
          style={{ fontFamily: "var(--editor-font)" }}
          placeholder="Untitled"
        />
      </div>
      <div ref={host} className="text-[16px]" />
      <div className="min-h-[30vh] cursor-text" onMouseDown={(e) => (e.preventDefault(), focusEnd())} />
      <Backlinks target={note} self={note} pane={pane} />

      {hover && <LinkHoverCard link={hover.link} rect={hover.rect} notebook={notebook} />}

      {bubble && !picker && (
        <button
          // Keep the editor's selection: don't take focus on press.
          onMouseDown={(e) => e.preventDefault()}
          onClick={openPicker}
          className="animate-pop fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-pop hover:text-accent"
          style={{ left: bubble.x, top: bubble.y - 8 }}
          title="Link these words to a note, quote, PDF or canvas (Ctrl+L)"
        >
          <Link2 size={13} className="text-accent" /> Link
          <span className="font-normal text-faint">Ctrl L</span>
        </button>
      )}

      {picker && (
        <LinkPicker
          notebook={notebook}
          note={note}
          anchor={picker}
          selectionText={picker.text}
          onClose={() => {
            setPicker(null);
            viewRef.current?.focus();
          }}
          onPick={(t) => {
            setPicker(null);
            if (viewRef.current) linkSelection(viewRef.current, t.target, t.fragment);
          }}
        />
      )}
    </div>
  );
}
