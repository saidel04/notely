import type { DragEvent } from "react";
import { formatLink } from "./links";

/** Drag payload for a highlighted passage (PDF → note or canvas). */
export const QUOTE_MIME = "application/x-notely-quote";
/** Drag payload for a sidebar item (note, PDF or canvas). */
export const ITEM_MIME = "application/x-notely-item";

export interface DraggedQuote {
  pdf: string;
  id: string;
  text: string;
  page: number;
}

/** The quote as Markdown: a blockquote plus a link back to the exact passage. */
export function quoteMarkdown(q: DraggedQuote) {
  const title = q.pdf.replace(/\.pdf$/i, "");
  return `> ${q.text}\n> — ${formatLink(q.pdf, q.id, `${title}, p. ${q.page}`)}`;
}

export function startQuoteDrag(e: DragEvent, q: DraggedQuote) {
  e.dataTransfer.setData(QUOTE_MIME, JSON.stringify(q));
  // Plain-text fallback, so dropping into any text field (or another app) still gives a cited quote.
  e.dataTransfer.setData("text/plain", quoteMarkdown(q));
  e.dataTransfer.effectAllowed = "copy";
}
