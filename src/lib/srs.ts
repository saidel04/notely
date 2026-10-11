// Spaced repetition for flashcards made from highlights. A small SM-2 variant
// (the algorithm behind Anki/SuperMemo): each card keeps an ease factor and an
// interval that grows when you remember it and resets when you don't.
// Pure logic only — the review panel and its storage live elsewhere.

export type Grade = "again" | "hard" | "good" | "easy";
export const GRADES: Grade[] = ["again", "hard", "good", "easy"];

export interface CardState {
  /** Interval multiplier (≥ 1.3). */
  ease: number;
  /** Days until the next review (0 while (re)learning). */
  interval: number;
  /** Successful reviews in a row. */
  reps: number;
  lapses: number;
  /** When the card is next due (epoch ms). */
  due: number;
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
const RELEARN = 10 * MINUTE;
const MIN_EASE = 1.3;

export const newCard = (): CardState => ({ ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0 });

/** The next interval in days for each grade (again = 0, relearn in minutes). */
function intervals(s: CardState) {
  // First two steps are fixed (and distinct, so every answer means something).
  if (s.reps === 0) return { again: 0, hard: 1, good: 2, easy: 4 };
  if (s.reps === 1) return { again: 0, hard: 3, good: 5, easy: 8 };
  const hard = Math.max(s.interval + 1, Math.round(s.interval * 1.2));
  const good = Math.max(hard + 1, Math.round(s.interval * s.ease));
  const easy = Math.max(good + 1, Math.round(s.interval * s.ease * 1.3));
  return { again: 0, hard, good, easy };
}

/** The card's state after answering it with `grade` at time `now`. */
export function schedule(s: CardState, grade: Grade, now: number): CardState {
  const next = intervals(s)[grade];
  if (grade === "again") {
    return { ease: Math.max(MIN_EASE, s.ease - 0.2), interval: 0, reps: 0, lapses: s.lapses + (s.reps > 0 ? 1 : 0), due: now + RELEARN };
  }
  const ease = grade === "hard" ? Math.max(MIN_EASE, s.ease - 0.15) : grade === "easy" ? s.ease + 0.15 : s.ease;
  return { ease, interval: next, reps: s.reps + 1, lapses: s.lapses, due: now + next * DAY };
}

/** "10m", "1d", "3w", "2mo", "1.5y" — for labeling the answer buttons. */
export function formatInterval(ms: number): string {
  if (ms < DAY) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  const d = ms / DAY;
  if (d < 14) return `${Math.round(d)}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round((d / 365) * 10) / 10}y`;
}

/** What each answer would schedule the card for, as labels. */
export function previewIntervals(s: CardState, now: number): Record<Grade, string> {
  const out = {} as Record<Grade, string>;
  for (const g of GRADES) out[g] = formatInterval(schedule(s, g, now).due - now);
  return out;
}

export interface DeckCard {
  /** The highlight id — stable across PDF renames. */
  id: string;
  /** For ordering new cards: PDF name, then page. */
  order: [string, number];
}

/**
 * Today's queue: cards that are due (oldest first), then up to `newLimit`
 * never-seen cards in reading order.
 */
export function buildQueue<C extends DeckCard>(cards: C[], states: Record<string, CardState>, now: number, newLimit = 20): C[] {
  const due = cards
    .filter((c) => states[c.id] && states[c.id].due <= now)
    .sort((a, b) => states[a.id].due - states[b.id].due);
  const fresh = cards
    .filter((c) => !states[c.id])
    .sort((a, b) => a.order[0].localeCompare(b.order[0]) || a.order[1] - b.order[1])
    .slice(0, newLimit);
  return [...due, ...fresh];
}

export function deckStats(cards: DeckCard[], states: Record<string, CardState>, now: number) {
  let due = 0;
  let fresh = 0;
  let next = Infinity;
  for (const c of cards) {
    const s = states[c.id];
    if (!s) fresh++;
    else if (s.due <= now) due++;
    else next = Math.min(next, s.due);
  }
  return { due, fresh, total: cards.length, nextDue: Number.isFinite(next) ? next : null };
}
