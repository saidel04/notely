import { useEffect, useMemo, useRef, useState } from "react";
import { extractAll, findInPages, matchRects, PageText, TextMatch } from "../../lib/pdfText";
import { Rect } from "../../store/highlightStore";
import { PDFDocumentProxy } from "./pdfjs";

export interface SearchHit {
  rect: Rect;
  current: boolean;
}

const NO_HITS: SearchHit[] = [];

/**
 * In-PDF search. Text is extracted lazily the first time search opens, in the
 * background, so matches stream in for long books.
 */
export function usePdfSearch(doc: PDFDocumentProxy | null) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [texts, setTexts] = useState<PageText[]>([]);
  const [indexed, setIndexed] = useState(0);
  const [index, setIndex] = useState(0);
  const started = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open || !doc || started.current === doc) return;
    started.current = doc;
    const signal = { cancelled: false };
    const acc: PageText[] = [];
    setTexts([]);
    setIndexed(0);
    void extractAll(
      doc,
      (page, t) => {
        acc.push(t);
        // Publish in batches so long books don't re-render on every page.
        if (page % 25 === 0 || page === doc.numPages) {
          setTexts([...acc]);
          setIndexed(page);
        }
      },
      signal,
    ).catch(() => {});
    return () => {
      signal.cancelled = true;
      started.current = null;
    };
  }, [open, doc]);

  const matches: TextMatch[] = useMemo(
    () => (open ? findInPages(texts.map((t) => t.text), debounced) : []),
    [texts, debounced, open],
  );

  const current = matches.length ? Math.min(index, matches.length - 1) : -1;

  /** Search hits grouped by page, for the page overlays. */
  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>();
    matches.forEach((m, i) => {
      const pt = texts[m.page - 1];
      if (!pt) return;
      const list = map.get(m.page) ?? [];
      for (const rect of matchRects(m.page, pt, m.start, m.end)) list.push({ rect, current: i === current });
      map.set(m.page, list);
    });
    return map;
  }, [matches, texts, current]);

  return {
    open,
    setOpen,
    query,
    setQuery,
    debounced,
    matches,
    current,
    setIndex,
    indexing: open && !!doc && indexed < doc.numPages,
    progress: doc ? indexed / doc.numPages : 0,
    hitsFor: (page: number) => hitsByPage.get(page) ?? NO_HITS,
    rectOf: (i: number) => {
      const m = matches[i];
      const pt = m && texts[m.page - 1];
      return pt ? matchRects(m.page, pt, m.start, m.end)[0] : undefined;
    },
  };
}
