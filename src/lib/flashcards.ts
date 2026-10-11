// Flashcard decks: a `.cards` file in a notebook, one card per line written as
// `Question: answer`. Comment/heading lines start with `#`, blank lines are
// ignored, and a line with no colon is reported as a problem rather than
// silently dropped. Pure parsing only — storage and review live elsewhere.

export interface Card {
  /** Stable across edits to the answer and across deck renames (see `cardId`). */
  id: string;
  /** 1-based line in the file, for jumping to it in the editor. */
  line: number;
  question: string;
  answer: string;
}

/** A line that looks like a card but isn't one, so the user can fix it. */
export interface DeckProblem {
  line: number;
  text: string;
}

export interface Deck {
  cards: Card[];
  problems: DeckProblem[];
}

export const DECK_EXT = ".cards";

/** What a new deck starts with: the syntax, as comments, so nothing is due yet. */
export const NEW_DECK = `# One flashcard per line, written as "Question: answer".
# Lines starting with # are notes to yourself and never become cards.
# Write a colon inside a question as \\:
#
# What does ATP stand for?: Adenosine triphosphate

`;

/**
 * A card's id: a hash of its question alone. So fixing a typo in the answer or
 * renaming the deck keeps the card's review progress, while rewriting the
 * question makes it a new card.
 */
export function cardId(question: string): string {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  // FNV-1a, in two halves so short questions still spread out.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    h1 = Math.imul(h1 ^ key.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + key.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `card-${h1.toString(36)}${h2.toString(36)}`;
}

/** Splits a line at its first unescaped colon; `\:` is a literal colon. */
function splitCard(line: string): [string, string] | null {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === ":") {
      i++;
      continue;
    }
    if (line[i] === ":") return [line.slice(0, i), line.slice(i + 1)];
  }
  return null;
}

const unescape = (s: string) => s.replace(/\\:/g, ":").trim();

/**
 * Parses a deck file. Cards keep file order; a question repeated in the deck is
 * kept once (the same question is the same card), so reviewing never asks twice.
 */
export function parseDeck(text: string): Deck {
  const cards: Card[] = [];
  const problems: DeckProblem[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = splitCard(line);
    const question = parts ? unescape(parts[0]) : "";
    const answer = parts ? unescape(parts[1]) : "";
    if (!question || !answer) return problems.push({ line: i + 1, text: line });
    const id = cardId(question);
    if (seen.has(id)) return;
    seen.add(id);
    cards.push({ id, line: i + 1, question, answer });
  });

  return { cards, problems };
}

/** One card as a deck line, escaping a colon in the question. */
export const cardLine = (question: string, answer: string) =>
  `${question.trim().replace(/:/g, "\\:")}: ${answer.trim()}`;

/** Appends cards to a deck's text, keeping exactly one blank line at the end. */
export function appendCards(text: string, lines: string[]): string {
  const body = text.replace(/\s+$/, "");
  return `${body ? `${body}\n` : ""}${lines.join("\n")}\n`;
}
