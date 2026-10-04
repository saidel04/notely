// PDF text extraction + search, shared by the in-PDF search bar and notebook search.
// Both build page strings with `buildPageText`, so match offsets agree between them.

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Rect } from "../store/highlightStore";

export interface ItemGeo {
  start: number;
  end: number;
  /** Item box normalized to the page (0–1), top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageText {
  text: string;
  items: ItemGeo[];
}

export interface TextMatch {
  page: number;
  start: number;
  end: number;
}

interface RawItem {
  str: string;
  hasEOL?: boolean;
}

/** Joins text items into one searchable string; line ends become spaces. */
export function buildPageText<T extends RawItem>(items: T[]): { text: string; spans: [number, number, T][] } {
  let text = "";
  const spans: [number, number, T][] = [];
  for (const it of items) {
    const start = text.length;
    text += it.str;
    spans.push([start, text.length, it]);
    if (it.hasEOL && !text.endsWith(" ")) text += " ";
  }
  return { text, spans };
}

export async function extractPage(page: PDFPageProxy): Promise<PageText> {
  const content = await page.getTextContent();
  const items = content.items.filter((i): i is TextItem => "str" in i);
  const { text, spans } = buildPageText(items);
  const vp = page.getViewport({ scale: 1 });
  const geo: ItemGeo[] = [];
  for (const [start, end, it] of spans) {
    if (end === start) continue;
    const [, , c, d, e, f] = it.transform;
    const fontH = Math.hypot(c, d) || it.height || 10;
    // Text items are positioned at their baseline; pad for ascenders/descenders.
    const [x1, y1] = vp.convertToViewportPoint(e, f - fontH * 0.22) as number[];
    const [x2, y2] = vp.convertToViewportPoint(e + it.width, f + fontH * 0.88) as number[];
    geo.push({
      start,
      end,
      x: Math.min(x1, x2) / vp.width,
      y: Math.min(y1, y2) / vp.height,
      w: Math.abs(x2 - x1) / vp.width,
      h: Math.abs(y2 - y1) / vp.height,
    });
  }
  return { text, items: geo };
}

export async function extractAll(
  doc: PDFDocumentProxy,
  onPage?: (page: number, text: PageText) => void,
  signal?: { cancelled: boolean },
): Promise<PageText[]> {
  const out: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (signal?.cancelled) break;
    const p = await doc.getPage(i);
    const t = await extractPage(p);
    out.push(t);
    onPage?.(i, t);
  }
  return out;
}

/** Case-insensitive; any run of whitespace in the query matches any whitespace in the text. */
export function queryRegex(query: string): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  const pattern = q
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  return new RegExp(pattern, "gi");
}

export function findInPages(pages: string[], query: string, limit = 2000): TextMatch[] {
  const re = queryRegex(query);
  if (!re) return [];
  const out: TextMatch[] = [];
  pages.forEach((text, i) => {
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) continue;
      out.push({ page: i + 1, start: m.index!, end: m.index! + m[0].length });
      if (out.length >= limit) return;
    }
  });
  return out;
}

/** Approximate rects for a character range, interpolating within each text item. */
export function matchRects(page: number, pt: PageText, start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  for (const it of pt.items) {
    if (it.end <= start || it.start >= end) continue;
    const len = it.end - it.start;
    const a = (Math.max(start, it.start) - it.start) / len;
    const b = (Math.min(end, it.end) - it.start) / len;
    rects.push({ page, x: it.x + it.w * a, y: it.y, w: it.w * (b - a), h: it.h });
  }
  return rects;
}

export function snippet(text: string, start: number, end: number, radius = 60) {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  const clean = (s: string) => s.replace(/\s+/g, " ");
  return {
    before: (a > 0 ? "…" : "") + clean(text.slice(a, start)).trimStart(),
    match: clean(text.slice(start, end)),
    after: clean(text.slice(end, b)).trimEnd() + (b < text.length ? "…" : ""),
  };
}
