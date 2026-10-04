import { Rect } from "../../store/highlightStore";

/**
 * Turns the current DOM selection into page-normalized rects. Returns null if
 * the selection isn't inside this viewer's pages.
 */
export function selectionToRects(root: HTMLElement): { rects: Rect[]; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const pages = [...root.querySelectorAll<HTMLElement>("[data-page]")].map((el) => ({
    page: Number(el.dataset.page),
    box: el.getBoundingClientRect(),
  }));

  const raw: Rect[] = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pg = pages.find((p) => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom);
    if (!pg) continue;
    const { box } = pg;
    // Skip the giant rect produced by pdf.js's end-of-content filler.
    if (r.height > box.height * 0.15) continue;
    raw.push({
      page: pg.page,
      x: (r.left - box.left) / box.width,
      y: (r.top - box.top) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    });
  }
  const rects = mergeRects(raw);
  if (rects.length === 0) return null;

  const text = sel
    .toString()
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? { rects, text } : null;
}

/** Merges the many per-span rects into one rect per line. */
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    const sameLine =
      prev &&
      prev.page === r.page &&
      Math.abs(prev.y + prev.h / 2 - (r.y + r.h / 2)) < Math.min(prev.h, r.h) * 0.5 &&
      r.x <= prev.x + prev.w + Math.max(prev.h, r.h) * 1.2;
    if (sameLine) {
      const x = Math.min(prev.x, r.x);
      const y = Math.min(prev.y, r.y);
      prev.w = Math.max(prev.x + prev.w, r.x + r.w) - x;
      prev.h = Math.max(prev.y + prev.h, r.y + r.h) - y;
      prev.x = x;
      prev.y = y;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Position of a client point within a page element, normalized 0–1. */
export function pointOnPage(root: HTMLElement, clientX: number, clientY: number) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-page]")) {
    const b = el.getBoundingClientRect();
    if (clientX >= b.left && clientX <= b.right && clientY >= b.top && clientY <= b.bottom) {
      return { page: Number(el.dataset.page), x: (clientX - b.left) / b.width, y: (clientY - b.top) / b.height };
    }
  }
  return null;
}
