import { useEffect, useMemo } from "react";
import { DeckCard, deckStats } from "../lib/srs";
import { Highlight, hlKey, useHighlights } from "./highlightStore";
import { useReview } from "./reviewStore";
import { useVault } from "./vaultStore";

/** A flashcard: one highlight (its comment is the question, the passage the answer). */
export interface Flashcard extends DeckCard {
  pdf: string;
  hl: Highlight;
}

/** Flashcards for a notebook — every highlight in its PDFs, or just one PDF's. */
export function useDeck(notebook: string | null, pdf: string | null = null) {
  const nb = useVault((s) => s.notebooks.find((n) => n.name === notebook));
  const byPdf = useHighlights((s) => s.byPdf);
  const pdfs = useMemo(() => (nb?.pdfs.map((p) => p.name) ?? []).filter((p) => !pdf || p === pdf), [nb, pdf]);

  useEffect(() => {
    if (!notebook) return;
    for (const p of pdfs) void useHighlights.getState().ensure(notebook, p);
    void useReview.getState().load(notebook);
  }, [notebook, pdfs]);

  const cards = useMemo<Flashcard[]>(
    () =>
      notebook
        ? pdfs.flatMap((p) =>
            (byPdf[hlKey(notebook, p)] ?? [])
              .filter((h) => h.text.trim())
              .map((h) => ({ id: h.id, order: [p, h.page] as [string, number], pdf: p, hl: h })),
          )
        : [],
    [byPdf, pdfs, notebook],
  );
  const loaded = !!notebook && pdfs.every((p) => byPdf[hlKey(notebook, p)] !== undefined);
  return { cards, loaded };
}

/** Cards to review now in the active notebook (due + new, as a session would show). */
export function useDueCount(newLimit = 20) {
  const notebook = useVault((s) => s.activeNotebook);
  const { cards } = useDeck(notebook);
  const states = useReview((s) => (s.notebook === notebook ? s.states : null));
  return useMemo(() => {
    if (!states) return 0;
    const s = deckStats(cards, states, Date.now());
    return s.due + Math.min(s.fresh, newLimit);
  }, [cards, states, newLimit]);
}
