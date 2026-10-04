import {
  Bookmark as BookmarkIcon,
  ChevronDown,
  GripVertical,
  MessageSquare,
  Moon,
  Sun,
  SunMoon,
  Coffee,
  ChevronUp,
  Download,
  FilePlus2,
  Highlighter,
  Link2,
  Loader2,
  MessageSquareQuote,
  Minus,
  MoveHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { startQuoteDrag } from "../../lib/dragQuote";
import { exportHighlights, noteFromHighlights } from "../../lib/exporting";
import { formatLink } from "../../lib/links";
import { settings, setSettingSoon } from "../../lib/settings";
import { errorMessage, vaultApi } from "../../lib/vault";
import { Highlight, HIGHLIGHT_COLORS, HighlightColor, hlKey, useHighlights } from "../../store/highlightStore";
import { PdfTheme, useUi } from "../../store/uiStore";
import { PaneIndex, PdfTarget, useWorkspace } from "../../store/workspaceStore";
import { useBacklinks } from "../editor/Backlinks";
import { BookmarksPanel } from "./BookmarksPanel";
import { Floating, Menu } from "../ui/Menu";
import { pointOnPage, selectionToRects } from "./geometry";
import { PdfPage } from "./PdfPage";
import { pdfAssets, pdfjs, PDFDocumentProxy } from "./pdfjs";
import { usePdfSearch } from "./usePdfSearch";

const GAP = 14;
const PAD = 28;
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;

type Zoom = { fit: true } | { fit: false; scale: number };

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text);
  useUi.getState().toast(`${what} copied — paste into a note, or onto selected words to link them`);
}

function Swatch({ color, onClick, active }: { color: HighlightColor; onClick: () => void; active?: boolean }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={color}
      className={`size-[18px] rounded-full border border-black/10 hl-${color} transition-transform hover:scale-110 ${
        active ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
      }`}
      style={{ mixBlendMode: "normal" }}
    />
  );
}

export function PdfViewer({
  notebook,
  pdf,
  pane,
  target,
}: {
  notebook: string;
  pdf: string;
  pane: PaneIndex;
  target?: PdfTarget;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<Zoom>({ fit: true });
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  const [current, setCurrent] = useState(1);
  const [flash, setFlash] = useState<{ id: string | null; page: number | null }>({ id: null, page: null });
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const [hlMenu, setHlMenu] = useState<{ x: number; y: number; hl: Highlight } | null>(null);
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; page: number } | null>(null);
  const [panel, setPanel] = useState<null | "highlights" | "mentions" | "bookmarks">(null);
  const [comment, setComment] = useState<{ x: number; y: number; hl: Highlight } | null>(null);
  const [newBookmark, setNewBookmark] = useState<string | null>(null);
  /** Highlight under the pointer, for the drag grip. */
  const [hoverHl, setHoverHl] = useState<{ hl: Highlight; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const appTheme = useUi((s) => s.theme);
  const pdfTheme = useUi((s) => s.pdfTheme);
  const pageTheme: Exclude<PdfTheme, "auto"> =
    pdfTheme !== "auto"
      ? pdfTheme
      : appTheme === "dark" || (appTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
  const restored = useRef(false);
  const posKey = `pos:${notebook}/${pdf}`;

  const highlights = useHighlights((s) => s.byPdf[hlKey(notebook, pdf)]) ?? [];
  const bookmarks = useHighlights((s) => s.bookmarks[hlKey(notebook, pdf)]) ?? [];
  const hlApi = useHighlights.getState();
  const mentions = useBacklinks(pdf);
  const search = usePdfSearch(doc);
  const searchInput = useRef<HTMLInputElement>(null);
  /** Page a search was requested from (notebook search); the first match at/after it is shown. */
  const searchFromPage = useRef<number | null>(null);
  const searchJumped = useRef<string | null>(null);

  // ---------- load document ----------
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    restored.current = false;
    setDoc(null);
    setError(null);
    void hlApi.ensure(notebook, pdf);

    (async () => {
      try {
        const [buf, savedZoom] = await Promise.all([
          vaultApi.readPdf(notebook, pdf),
          settings.get<Zoom>(`zoom:${notebook}/${pdf}`),
        ]);
        if (cancelled) return;
        task = pdfjs.getDocument({ data: new Uint8Array(buf), ...pdfAssets });
        const d = await task.promise;
        if (cancelled) return;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        const initial: [number, number][] = Array.from({ length: d.numPages }, () => [first.width, first.height]);
        if (savedZoom) setZoom(savedZoom);
        setSizes(initial);
        setDoc(d);
        // Correct sizes of pages with different dimensions in the background.
        const real = await Promise.all(
          initial.map(async (s, i) => {
            if (i === 0) return s;
            const v = (await d.getPage(i + 1)).getViewport({ scale: 1 });
            return [v.width, v.height] as [number, number];
          }),
        );
        if (!cancelled && real.some((s, i) => s[0] !== initial[i][0] || s[1] !== initial[i][1])) setSizes(real);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [notebook, pdf]);

  // ---------- layout ----------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = useMemo(() => Math.max(1, ...sizes.map((s) => s[0])), [sizes]);
  const fitScale = width ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, (width - PAD * 2) / maxW)) : 1;
  const scale = zoom.fit ? fitScale : zoom.scale;

  const tops = useMemo(() => {
    const out: number[] = [];
    let y = PAD;
    for (const [, h] of sizes) {
      out.push(y);
      y += h * scale + GAP;
    }
    out.push(y - GAP + PAD); // total height
    return out;
  }, [sizes, scale]);

  const pageAt = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = sizes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
    [tops, sizes.length],
  );

  const updateVisible = useCallback(() => {
    const el = scroller.current;
    if (!el || sizes.length === 0) return;
    const margin = el.clientHeight;
    const first = pageAt(el.scrollTop - margin);
    const last = pageAt(el.scrollTop + el.clientHeight + margin);
    setVisible((prev) => {
      if (prev.size === last - first + 1 && prev.has(first) && prev.has(last)) return prev;
      const s = new Set<number>();
      for (let i = first; i <= last; i++) s.add(i);
      return s;
    });
    const cur = pageAt(el.scrollTop + el.clientHeight * 0.35);
    setCurrent(cur);
    const frac = (el.scrollTop - tops[cur - 1]) / (sizes[cur - 1][1] * scale);
    anchor.current = { page: cur, frac };
    if (restored.current) setSettingSoon(posKey, anchor.current, 800);
  }, [pageAt, sizes, tops, scale, posKey]);

  // Keep the same spot in view when zoom or pane width changes.
  const anchor = useRef<{ page: number; frac: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (el && a && sizes.length && restored.current) {
      el.scrollTop = tops[a.page - 1] + a.frac * sizes[a.page - 1][1] * scale;
    }
    updateVisible();
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollTo = useCallback(
    (page: number, yFrac = 0, smooth = false) => {
      const el = scroller.current;
      if (!el || !sizes.length) return;
      const p = Math.max(1, Math.min(sizes.length, page));
      const y = tops[p - 1] + yFrac * sizes[p - 1][1] * scale - (yFrac ? el.clientHeight * 0.3 : 12);
      el.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
    },
    [tops, sizes, scale],
  );

  // ---------- navigation targets ----------
  const goTo = useCallback(
    async (t: { page?: number; highlightId?: string; bookmarkId?: string; search?: string }, smooth: boolean) => {
      if (t.search) {
        searchFromPage.current = t.page ?? 1;
        searchJumped.current = null;
        search.setQuery(t.search);
        search.setOpen(true);
        if (t.page) scrollTo(t.page, 0, smooth);
        return;
      }
      if (t.highlightId) {
        const list = await useHighlights.getState().ensure(notebook, pdf);
        const hl = list.find((h) => h.id === t.highlightId);
        if (!hl) return useUi.getState().toast("That highlight no longer exists", "error");
        scrollTo(hl.rects[0]?.page ?? hl.page, hl.rects[0]?.y ?? 0, smooth);
        setFlash({ id: hl.id, page: null });
      } else if (t.bookmarkId) {
        const list = await useHighlights.getState().ensureBookmarks(notebook, pdf);
        const bm = list.find((b) => b.id === t.bookmarkId);
        if (!bm) return useUi.getState().toast("That bookmark no longer exists", "error");
        scrollTo(bm.page, bm.y, smooth);
        setFlash({ id: null, page: bm.page });
      } else if (t.page) {
        scrollTo(t.page, 0, smooth);
        setFlash({ id: null, page: t.page });
      }
      window.setTimeout(() => setFlash({ id: null, page: null }), 1600);
    },
    [notebook, pdf, scrollTo], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // First paint: honour the link target, or restore the last reading position.
  useEffect(() => {
    if (!doc || !width || restored.current) return;
    (async () => {
      if (target?.page || target?.highlightId || target?.bookmarkId || target?.search) await goTo(target, false);
      else {
        const pos = await settings.get<{ page: number; frac: number }>(posKey);
        if (pos) {
          const el = scroller.current!;
          el.scrollTop = tops[pos.page - 1] + pos.frac * sizes[pos.page - 1][1] * scale;
        }
      }
      restored.current = true;
      updateVisible();
    })();
  }, [doc, width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Later link clicks while already open.
  const lastNonce = useRef(target?.nonce);
  useEffect(() => {
    if (!target || target.nonce === lastNonce.current) return;
    lastNonce.current = target.nonce;
    if (restored.current) void goTo(target, true);
  }, [target, goTo]);

  // ---------- search ----------
  const goToMatch = (i: number) => {
    const n = search.matches.length;
    if (!n) return;
    const idx = ((i % n) + n) % n;
    search.setIndex(idx);
    const m = search.matches[idx];
    scrollTo(m.page, search.rectOf(idx)?.y ?? 0);
  };

  // Jump to the first match at/after the current page whenever the query changes.
  useEffect(() => {
    if (!search.open || !search.debounced) {
      searchJumped.current = null;
      return;
    }
    if (searchJumped.current === search.debounced || !search.matches.length) return;
    const from = searchFromPage.current ?? current;
    const i = search.matches.findIndex((m) => m.page >= from);
    if (i === -1 && search.indexing) return; // later pages may still match
    searchJumped.current = search.debounced;
    searchFromPage.current = null;
    goToMatch(i === -1 ? 0 : i);
  }, [search.matches, search.debounced, search.open, search.indexing]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSearch = () => {
    search.setOpen(true);
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  };

  // ---------- zoom ----------
  const setScale = useCallback(
    (next: Zoom) => {
      const z: Zoom = next.fit ? next : { fit: false, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, next.scale)) };
      setZoom(z);
      setSettingSoon(`zoom:${notebook}/${pdf}`, z);
    },
    [notebook, pdf],
  );
  const zoomBy = (f: number) => setScale({ fit: false, scale: Math.round(scale * f * 100) / 100 });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale({ fit: false, scale: scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, setScale]);

  const focusedPane = useWorkspace((s) => s.focused);
  useEffect(() => {
    if (focusedPane !== pane) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "b" && !(e.target as HTMLElement).closest?.(".cm-editor, input, textarea")) {
        e.preventDefault();
        return addBookmarkHere();
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "f" && !(e.target as HTMLElement).closest?.(".cm-editor")) {
        e.preventDefault();
        return openSearch();
      }
      if (!e.ctrlKey || (e.target as HTMLElement).closest?.(".cm-editor, input")) return;
      if (e.key === "=" || e.key === "+") zoomBy(1.15);
      else if (e.key === "-") zoomBy(1 / 1.15);
      else if (e.key === "0") setScale({ fit: true });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- highlighting ----------
  const createHighlight = (color: HighlightColor) => {
    const root = scroller.current;
    if (!root) return null;
    const sel = selectionToRects(root);
    if (!sel) return null;
    const hl = hlApi.add(notebook, pdf, { page: sel.rects[0].page, rects: sel.rects, text: sel.text, color });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    return hl;
  };

  const hlLink = (h: Highlight) => formatLink(pdf, h.id);

  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Let the browser finalize the selection first.
    requestAnimationFrame(() => {
      const root = scroller.current;
      if (!root) return;
      const sel = selectionToRects(root);
      if (sel) {
        const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
        setSelection({ x: r.left + r.width / 2 - 90, y: r.top });
        return;
      }
      setSelection(null);
      // A plain click on a highlight opens its menu.
      const hit = hitHighlight(e.clientX, e.clientY);
      if (hit) setHlMenu({ x: e.clientX, y: e.clientY + 6, hl: hit });
    });
  };

  const hitHighlight = (cx: number, cy: number) => {
    const root = scroller.current;
    const pt = root && pointOnPage(root, cx, cy);
    if (!pt) return null;
    return (
      highlights.find((h) =>
        h.rects.some((r) => r.page === pt.page && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h),
      ) ?? null
    );
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hit = hitHighlight(e.clientX, e.clientY);
    if (hit) return setHlMenu({ x: e.clientX, y: e.clientY, hl: hit });
    const pt = scroller.current && pointOnPage(scroller.current, e.clientX, e.clientY);
    if (pt) setPageMenu({ x: e.clientX, y: e.clientY, page: pt.page });
  };

  // ---------- bookmarks ----------
  const addBookmarkHere = () => {
    const a = anchor.current ?? { page: current, frac: 0 };
    const bm = useHighlights.getState().addBookmark(notebook, pdf, { page: a.page, y: Math.max(0, Math.min(1, a.frac)), name: `Page ${a.page}` });
    setPanel("bookmarks");
    setNewBookmark(bm.id);
  };

  // ---------- drag grip over highlights ----------
  const trackHover = (e: React.MouseEvent) => {
    if (e.buttons || selection) return;
    const hit = hitHighlight(e.clientX, e.clientY);
    if (!hit) return hoverHl && setHoverHl(null);
    if (hoverHl?.hl.id === hit.id) return;
    const r = hit.rects[0];
    const pageEl = scroller.current?.querySelector<HTMLElement>(`[data-page="${r.page}"]`);
    const root = rootRef.current;
    if (!pageEl || !root) return;
    const pb = pageEl.getBoundingClientRect();
    const rb = root.getBoundingClientRect();
    setHoverHl({ hl: hit, x: pb.left + r.x * pb.width - rb.left - 20, y: pb.top + r.y * pb.height - rb.top });
  };

  // ---------- render ----------
  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-backdrop p-8 text-center text-[13px] text-muted">
        Couldn't open this PDF.
        <br />
        {error}
      </div>
    );
  }

  const total = sizes.length;

  return (
    <div ref={rootRef} data-page-theme={pageTheme} className="group/pdf relative h-full bg-backdrop">
      <div
        ref={scroller}
        className="h-full overflow-auto"
        onScroll={() => {
          updateVisible();
          if (selection) setSelection(null);
          if (hoverHl) setHoverHl(null);
        }}
        onMouseMove={trackHover}
        onMouseLeave={(e) => {
          if (!(e.relatedTarget as HTMLElement | null)?.closest?.(".hl-grip")) setHoverHl(null);
        }}
        onMouseUp={onMouseUp}
        onMouseDown={() => setSelection(null)}
        onContextMenu={onContextMenu}
      >
        {!doc ? (
          <div className="flex h-full items-center justify-center text-faint">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : (
          <div className="relative" style={{ height: tops[total], minWidth: maxW * scale + PAD * 2 }}>
            {sizes.map(([w, h], i) => (
              <div
                key={i}
                className="absolute right-0 left-0 flex justify-center"
                style={{ top: tops[i] }}
              >
                <PdfPage
                  doc={doc}
                  page={i + 1}
                  scale={scale}
                  width={Math.floor(w * scale)}
                  height={Math.floor(h * scale)}
                  visible={visible.has(i + 1)}
                  highlights={highlights}
                  flashId={flash.id}
                  flashPage={flash.page === i + 1}
                  searchHits={search.hitsFor(i + 1)}
                  bookmarks={bookmarks}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating controls: only visible while the pointer is over the PDF. */}
      {doc && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center opacity-0 transition-opacity duration-200 group-hover/pdf:opacity-100">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface/95 px-1.5 py-1 text-[12px] text-muted shadow-pop backdrop-blur">
            <PageInput current={current} total={total} onGo={(p) => scrollTo(p)} />
            <Sep />
            <IconBtn title="Zoom out (Ctrl −)" onClick={() => zoomBy(1 / 1.15)}>
              <Minus size={14} />
            </IconBtn>
            <button
              className="w-11 rounded-md py-1 text-center tabular-nums hover:bg-hover hover:text-ink"
              title="Fit width (Ctrl 0)"
              onClick={() => setScale({ fit: true })}
            >
              {Math.round(scale * 100)}%
            </button>
            <IconBtn title="Zoom in (Ctrl +)" onClick={() => zoomBy(1.15)}>
              <Plus size={14} />
            </IconBtn>
            <IconBtn title="Fit width" active={zoom.fit} onClick={() => setScale({ fit: true })}>
              <MoveHorizontal size={14} />
            </IconBtn>
            <Sep />
            <IconBtn title="Find in PDF (Ctrl+F)" active={search.open} onClick={openSearch}>
              <Search size={14} />
            </IconBtn>
            <IconBtn title="Copy link to this page" onClick={() => copy(formatLink(pdf, `page=${current}`), "Page link")}>
              <Link2 size={14} />
            </IconBtn>
            <IconBtn title="Highlights" active={panel === "highlights"} onClick={() => setPanel(panel === "highlights" ? null : "highlights")}>
              <Highlighter size={14} />
              {highlights.length > 0 && <span className="ml-1 tabular-nums">{highlights.length}</span>}
            </IconBtn>
            <IconBtn title="Bookmarks & contents (Ctrl+B to add)" active={panel === "bookmarks"} onClick={() => setPanel(panel === "bookmarks" ? null : "bookmarks")}>
              <BookmarkIcon size={14} />
              {bookmarks.length > 0 && <span className="ml-1 tabular-nums">{bookmarks.length}</span>}
            </IconBtn>
            <PageThemeButton />
            <IconBtn title="Notes that link here" active={panel === "mentions"} onClick={() => setPanel(panel === "mentions" ? null : "mentions")}>
              <MessageSquareQuote size={14} />
              {mentions.length > 0 && <span className="ml-1 tabular-nums">{mentions.length}</span>}
            </IconBtn>
          </div>
        </div>
      )}

      {search.open && (
        <div className="animate-pop absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-line bg-surface py-1 pr-1 pl-2.5 shadow-pop">
          <Search size={14} className="shrink-0 text-faint" />
          <input
            ref={searchInput}
            value={search.query}
            onChange={(e) => {
              searchJumped.current = null;
              search.setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToMatch(search.current + (e.shiftKey ? -1 : 1));
              else if (e.key === "Escape") search.setOpen(false);
              else return;
              e.preventDefault();
            }}
            placeholder="Find in PDF"
            spellCheck={false}
            className="w-44 bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-faint"
          />
          <span className="min-w-[64px] text-right text-[11.5px] text-faint tabular-nums">
            {search.debounced
              ? search.matches.length
                ? `${search.current + 1} / ${search.matches.length}${search.indexing ? "+" : ""}`
                : search.indexing
                  ? `${Math.round(search.progress * 100)}%`
                  : "No results"
              : search.indexing
                ? `Indexing ${Math.round(search.progress * 100)}%`
                : ""}
          </span>
          <IconBtn title="Previous (Shift+Enter)" onClick={() => goToMatch(search.current - 1)}>
            <ChevronUp size={14} />
          </IconBtn>
          <IconBtn title="Next (Enter)" onClick={() => goToMatch(search.current + 1)}>
            <ChevronDown size={14} />
          </IconBtn>
          <IconBtn title="Close (Esc)" onClick={() => search.setOpen(false)}>
            <X size={14} />
          </IconBtn>
        </div>
      )}

      {panel && (
        <SidePanel
          title={panel === "highlights" ? "Highlights" : panel === "bookmarks" ? "Bookmarks" : "Mentioned in"}
          onClose={() => setPanel(null)}
          actions={
            panel === "highlights" && highlights.length > 0 ? (
              <>
                <IconBtn title="Collect highlights into a new note" onClick={() => noteFromHighlights(pdf)}>
                  <FilePlus2 size={14} />
                </IconBtn>
                <IconBtn title="Export highlights as Markdown" onClick={() => exportHighlights(pdf)}>
                  <Download size={14} />
                </IconBtn>
              </>
            ) : null
          }
        >
          {panel === "bookmarks" && doc ? (
            <BookmarksPanel
              notebook={notebook}
              pdf={pdf}
              doc={doc}
              editingId={newBookmark}
              onEditDone={() => setNewBookmark(null)}
              onAdd={addBookmarkHere}
              onGo={(page, y) => {
                scrollTo(page, y ?? 0, true);
                setFlash({ id: null, page });
                window.setTimeout(() => setFlash({ id: null, page: null }), 1600);
              }}
            />
          ) : panel === "highlights" ? (
            highlights.length === 0 ? (
              <Empty>Select text in the PDF to highlight it.</Empty>
            ) : (
              highlights.map((h) => (
                <button
                  key={h.id}
                  draggable
                  onDragStart={(e) => startQuoteDrag(e, { pdf, id: h.id, text: h.text, page: h.page })}
                  title="Click to go there · drag into a note or canvas"
                  onClick={() => goTo({ highlightId: h.id }, true)}
                  onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), setHlMenu({ x: e.clientX, y: e.clientY, hl: h }))}
                  className="flex w-full gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover"
                >
                  <span className={`mt-1 h-3.5 w-1 shrink-0 rounded-full hl-${h.color}`} style={{ mixBlendMode: "normal" }} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-3 text-[12.5px] leading-snug text-ink">{h.text}</span>
                    {h.comment && (
                      <span className="mt-1 flex gap-1.5 rounded-md bg-hover px-2 py-1 text-[12px] leading-snug text-muted">
                        <MessageSquare size={12} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-3">{h.comment}</span>
                      </span>
                    )}
                    <span className="text-[11px] text-faint">Page {h.page}</span>
                  </span>
                </button>
              ))
            )
          ) : mentions.length === 0 ? (
            <Empty>No notes link to this PDF yet. Copy a highlight link and paste it into a note.</Empty>
          ) : (
            mentions.map((m) => (
              <button
                key={m.note}
                onClick={(e) =>
                  useWorkspace.getState().open({ kind: "note", name: m.note }, e.ctrlKey ? { pane } : { pane: pane === 0 ? 1 : 0 })
                }
                className="w-full rounded-md px-2 py-2 text-left hover:bg-hover"
              >
                <div className="text-[12.5px] font-medium text-ink">{m.note}</div>
                {m.context && <div className="line-clamp-2 text-[12px] text-muted">{m.context}</div>}
              </button>
            ))
          )}
        </SidePanel>
      )}

      {selection && (
        <Floating x={selection.x} y={selection.y} placement="above" onClose={() => setSelection(null)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
          {HIGHLIGHT_COLORS.map((c) => (
            <Swatch key={c} color={c} onClick={() => createHighlight(c)} />
          ))}
          <div className="mx-0.5 h-4 w-px bg-line" />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const hl = createHighlight("yellow");
              if (hl) void copy(hlLink(hl), "Highlight link");
            }}
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-ink"
            title="Highlight and copy a link to it"
          >
            <Link2 size={13} /> Link
          </button>
        </Floating>
      )}

      {hlMenu && (
        <Menu
          x={hlMenu.x}
          y={hlMenu.y}
          onClose={() => setHlMenu(null)}
          header={
            <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <Swatch
                  key={c}
                  color={c}
                  active={hlMenu.hl.color === c}
                  onClick={() => {
                    hlApi.update(notebook, pdf, hlMenu.hl.id, { color: c });
                    setHlMenu(null);
                  }}
                />
              ))}
            </div>
          }
          items={[
            "divider",
            {
              label: hlMenu.hl.comment ? "Edit comment" : "Add comment",
              icon: <MessageSquare />,
              onSelect: () => setComment({ x: hlMenu.x, y: hlMenu.y, hl: hlMenu.hl }),
            },
            { label: "Copy link", icon: <Link2 />, onSelect: () => copy(hlLink(hlMenu.hl), "Highlight link") },
            { label: "Copy text", icon: <MessageSquareQuote />, onSelect: () => copy(hlMenu.hl.text, "Text") },
            { label: "Delete highlight", icon: <Trash2 />, danger: true, onSelect: () => hlApi.remove(notebook, pdf, hlMenu.hl.id) },
          ]}
        />
      )}

      {hoverHl && !selection && (
        <div
          draggable
          onDragStart={(e) => startQuoteDrag(e, { pdf, id: hoverHl.hl.id, text: hoverHl.hl.text, page: hoverHl.hl.page })}
          // Hide only once the drag is over: removing the source mid-drag cancels it.
          onDragEnd={() => setHoverHl(null)}
          onMouseLeave={(e) => {
            if (!(e.relatedTarget as HTMLElement | null)?.closest?.("[data-page]")) setHoverHl(null);
          }}
          title="Drag this quote into a note or canvas"
          className="hl-grip animate-fade absolute z-10 flex h-6 w-4 cursor-grab items-center justify-center rounded border border-line bg-surface text-muted shadow-sm hover:text-accent active:cursor-grabbing"
          style={{ left: hoverHl.x, top: hoverHl.y }}
        >
          <GripVertical size={12} />
        </div>
      )}

      {comment && (
        <CommentEditor
          x={comment.x}
          y={comment.y}
          initial={comment.hl.comment ?? ""}
          quote={comment.hl.text}
          onClose={() => setComment(null)}
          onSave={(text) => {
            hlApi.update(notebook, pdf, comment.hl.id, { comment: text || undefined });
            setComment(null);
          }}
        />
      )}

      {pageMenu && (
        <Menu
          x={pageMenu.x}
          y={pageMenu.y}
          onClose={() => setPageMenu(null)}
          items={[
            { label: "Bookmark this spot", icon: <BookmarkIcon />, hint: "Ctrl+B", onSelect: addBookmarkHere },
            {
              label: `Copy link to page ${pageMenu.page}`,
              icon: <Link2 />,
              onSelect: () => copy(formatLink(pdf, `page=${pageMenu.page}`), "Page link"),
            },
          ]}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 hover:bg-hover hover:text-ink ${active ? "text-accent" : ""}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <div className="mx-1 h-4 w-px bg-line" />;

function PageInput({ current, total, onGo }: { current: number; total: number; onGo: (p: number) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-1 px-1.5 tabular-nums">
      <input
        value={value ?? String(current)}
        onFocus={(e) => (setValue(String(current)), e.target.select())}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setValue(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = parseInt(value ?? "", 10);
            if (n) onGo(n);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        className="w-8 rounded bg-transparent text-right text-ink outline-none focus:bg-hover"
      />
      <span className="text-faint">/ {total}</span>
    </div>
  );
}

function SidePanel({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-pop absolute top-3 right-3 bottom-16 z-10 flex w-[280px] flex-col rounded-xl border border-line bg-surface shadow-pop">
      <div className="flex items-center gap-1 pt-2 pr-1.5 pb-1.5 pl-3.5">
        <span className="flex-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">{title}</span>
        <span className="flex text-muted">{actions}</span>
        <IconBtn title="Close" onClick={onClose}>
          <X size={14} />
        </IconBtn>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">{children}</div>
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2.5 py-6 text-center text-[12.5px] leading-relaxed text-faint">{children}</div>
);

const THEMES: { value: PdfTheme; label: string; icon: React.ReactNode }[] = [
  { value: "auto", label: "Pages follow the app theme", icon: <SunMoon size={14} /> },
  { value: "light", label: "Light pages", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark pages", icon: <Moon size={14} /> },
  { value: "sepia", label: "Sepia pages", icon: <Coffee size={14} /> },
];

/** Cycles the page theme: auto → light → dark → sepia. */
function PageThemeButton() {
  const theme = useUi((s) => s.pdfTheme);
  const i = THEMES.findIndex((t) => t.value === theme);
  const cur = THEMES[i < 0 ? 0 : i];
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <IconBtn title={`${cur.label} — click for ${next.label.toLowerCase()}`} onClick={() => useUi.getState().setPdfTheme(next.value)}>
      {cur.icon}
    </IconBtn>
  );
}

function CommentEditor({
  x,
  y,
  initial,
  quote,
  onSave,
  onClose,
}: {
  x: number;
  y: number;
  initial: string;
  quote: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <Floating x={x} y={y} onClose={onClose} className="w-[320px] p-3">
      <div className="mb-2 line-clamp-2 border-l-2 border-line-strong pl-2 font-serif text-[12.5px] text-muted italic">{quote}</div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave(text.trim());
          if (e.key === "Escape") onClose();
          e.stopPropagation();
        }}
        placeholder="Your thoughts on this passage…"
        rows={4}
        className="w-full resize-none rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-faint">Ctrl+Enter to save</span>
        <div className="flex gap-1.5">
          {initial && (
            <button onClick={() => onSave("")} className="rounded-md px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-danger">
              Remove
            </button>
          )}
          <button onClick={() => onSave(text.trim())} className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white hover:opacity-90">
            Save
          </button>
        </div>
      </div>
    </Floating>
  );
}
