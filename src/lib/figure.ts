// "Capture a region" of a PDF page as a figure for a note. Pure helpers only.

import { imageMarkdown } from "./images";
import { formatLink, parseLinks, WikiLink } from "./links";

export interface Pt {
  x: number;
  y: number;
}

/** A box on one page, normalized to the page (0–1, top-left origin). */
export interface Region {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** The box between two client points, clipped to a page's on-screen rectangle. */
export function regionFrom(page: number, a: Pt, b: Pt, box: { left: number; top: number; width: number; height: number }): Region {
  const x0 = clamp((Math.min(a.x, b.x) - box.left) / box.width);
  const x1 = clamp((Math.max(a.x, b.x) - box.left) / box.width);
  const y0 = clamp((Math.min(a.y, b.y) - box.top) / box.height);
  const y1 = clamp((Math.max(a.y, b.y) - box.top) / box.height);
  return { page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Resolution to render a figure at, as a whole multiple of the page's natural
 * size: crisp (≥2×) but bounded so huge zooms don't blow up memory.
 */
export const captureScale = (viewScale: number, dpr: number) => Math.min(4, Math.max(2, Math.ceil(viewScale * dpr)));

/**
 * A short, file-friendly name for the figure's image. The `@Nx` suffix (the
 * usual retina convention) records the render scale, so the note can show the
 * figure at its natural size rather than N times larger.
 */
export function figureName(pdf: string, page: number, scale = 2) {
  const stem = pdf
    .replace(/\.pdf$/i, "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .slice(0, 40)
    .trim();
  return `${stem || "figure"} p${page}@${scale}x.png`;
}

/**
 * The figure as Markdown: just the image. The link back to its page rides in
 * the image's title — `![Book, p. 8](_assets/x.png "[[Book.pdf#page=8]]")` —
 * so the note shows no extra line, clicking the image opens the page, and
 * backlinks, citations and renames still see the link.
 */
export function figureMarkdown(imageName: string, pdf: string, page: number) {
  const title = pdf.replace(/\.pdf$/i, "");
  return imageMarkdown(imageName, `${title}, p. ${page}`, formatLink(pdf, `page=${page}`));
}

/** The [[link]] an image carries in its title (PDF figures), if any. */
export function imageSource(title: string | undefined): WikiLink | null {
  return (title && parseLinks(title)[0]) || null;
}
