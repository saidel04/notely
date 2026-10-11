import { useEffect, useMemo } from "react";
import { Card, parseDeck } from "../lib/flashcards";
import { DeckCard, deckStats } from "../lib/srs";
import { useDecks } from "./deckStore";
import { useReview } from "./reviewStore";
import { useVault } from "./vaultStore";

/** A flashcard: one `Question: answer` line of a deck file. */
export interface Flashcard extends DeckCard, Card {
  /** The deck (file) it comes from. */
  deck: string;
}

const toCards = (deck: string, cards: Card[]): Flashcard[] =>
  cards.map((c) => ({ ...c, deck, order: [deck, c.line] as [string, number] }));

/** The cards of one deck, parsed from its file as it is edited. */
export function useDeckCards(deck: string) {
  const text = useDecks((s) => s.text[deck]);
  return useMemo(() => parseDeck(text ?? ""), [text]);
}

/**
 * Flashcards for a notebook — every card in its decks, or just one deck's.
 * `loaded` is false until the decks' files have been read.
 */
export function useDeck(notebook: string | null, deck: string | null = null) {
  const nb = useVault((s) => s.notebooks.find((n) => n.name === notebook));
  const text = useDecks((s) => (s.notebook === notebook ? s.text : null));
  const names = useMemo(() => (nb?.decks.map((d) => d.name) ?? []).filter((d) => !deck || d === deck), [nb, deck]);

  useEffect(() => {
    if (notebook) void useReview.getState().load(notebook);
  }, [notebook]);

  const cards = useMemo<Flashcard[]>(
    () => (text ? names.flatMap((d) => toCards(d, parseDeck(text[d] ?? "").cards)) : []),
    [text, names],
  );
  const loaded = !notebook || (!!text && names.every((d) => d in text));
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
