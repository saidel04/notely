// PDF text extraction + search, shared by the in-PDF search bar and notebook search.
// Both build page strings with `buildPageText`, so match offsets agree between them.

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Rect } from "../store/highlightStore";

export interface ItemGeo {
  start: number;
  end: number;
  // The item's glyph box as three points in page-normalized viewport space
  // (0–1, top-left origin): the top-left and bottom-left corners at the start of
  // the baseline, plus the advance delta to the far edge. Storing it this way
  // keeps the box correct for rotated or skewed text — `matchRects` interpolates
  // a sub-range along the real baseline instead of assuming left-to-right.
  tx: number;
  ty: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
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
    const [a, b, c, d, e, f] = it.transform;
    // Text's own axes in PDF space: (a,b) advance direction, (c,d) up (height fontH).
    const adv = Math.hypot(a, b) || 1;
    const [ux, uy] = [a / adv, b / adv]; // unit advance
    const [ax, ay] = [ux * it.width, uy * it.width]; // full advance vector
    // Baseline origin, padded up for ascenders (0.88) and down for descenders (0.22).
    const topL = vp.convertToViewportPoint(e + c * 0.88, f + d * 0.88) as number[];
    const botL = vp.convertToViewportPoint(e - c * 0.22, f - d * 0.22) as number[];
    const topR = vp.convertToViewportPoint(e + ax + c * 0.88, f + ay + d * 0.88) as number[];
    geo.push({
      start,
      end,
      tx: topL[0] / vp.width,
      ty: topL[1] / vp.height,
      bx: botL[0] / vp.width,
      by: botL[1] / vp.height,
      dx: (topR[0] - topL[0]) / vp.width,
      dy: (topR[1] - topL[1]) / vp.height,
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

/**
 * Approximate rects for a character range. The range is interpolated along each
 * item's real baseline (so rotated/skewed text stays aligned), and the result is
 * the axis-aligned bounding box of that slice's four corners.
 */
export function matchRects(page: number, pt: PageText, start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  for (const it of pt.items) {
    if (it.end <= start || it.start >= end) continue;
    const len = it.end - it.start;
    const a = (Math.max(start, it.start) - it.start) / len;
    const b = (Math.min(end, it.end) - it.start) / len;
    // Four corners of the slice [a, b] along the baseline.
    const xs = [it.tx + it.dx * a, it.tx + it.dx * b, it.bx + it.dx * a, it.bx + it.dx * b];
    const ys = [it.ty + it.dy * a, it.ty + it.dy * b, it.by + it.dy * a, it.by + it.dy * b];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    rects.push({ page, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
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
