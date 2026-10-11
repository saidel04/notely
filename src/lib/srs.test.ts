import { describe, expect, it } from "vitest";
import { buildQueue, CardState, DAY, deckStats, formatInterval, MINUTE, newCard, previewIntervals, schedule } from "./srs";

const NOW = 1_800_000_000_000;

describe("schedule", () => {
  it("graduates a new card on good: 2 days, then 5, then interval × ease", () => {
    let s = schedule(newCard(), "good", NOW);
    expect(s.interval).toBe(2);
    expect(s.due).toBe(NOW + 2 * DAY);
    s = schedule(s, "good", NOW);
    expect(s.interval).toBe(5);
    s = schedule(s, "good", NOW);
    expect(s.interval).toBe(Math.round(5 * 2.5)); // 13
    expect(s.reps).toBe(3);
    expect(s.ease).toBe(2.5);
  });

  it("gives every answer a different interval, even on a new card", () => {
    for (const st of [newCard(), schedule(newCard(), "good", NOW)]) {
      const days = (["hard", "good", "easy"] as const).map((g) => schedule(st, g, NOW).interval);
      expect(new Set(days).size).toBe(3);
    }
  });

  it("again resets the card, counts a lapse, lowers ease and relearns in minutes", () => {
    const learned: CardState = { ease: 2.5, interval: 20, reps: 4, lapses: 0, due: NOW };
    const s = schedule(learned, "again", NOW);
    expect(s.reps).toBe(0);
    expect(s.interval).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.ease).toBeCloseTo(2.3);
    expect(s.due).toBe(NOW + 10 * MINUTE);
    // Failing a brand-new card isn't a lapse.
    expect(schedule(newCard(), "again", NOW).lapses).toBe(0);
  });

  it("keeps hard < good < easy, and ease never drops below 1.3", () => {
    const s: CardState = { ease: 1.3, interval: 10, reps: 5, lapses: 2, due: NOW };
    const [h, g, e] = (["hard", "good", "easy"] as const).map((gr) => schedule(s, gr, NOW).interval);
    expect(h).toBeLessThan(g);
    expect(g).toBeLessThan(e);
    expect(schedule(s, "hard", NOW).ease).toBe(1.3);
    expect(schedule(s, "easy", NOW).ease).toBeCloseTo(1.45);
  });
});

describe("labels", () => {
  it("formats intervals compactly", () => {
    expect(formatInterval(10 * MINUTE)).toBe("10m");
    expect(formatInterval(3 * DAY)).toBe("3d");
    expect(formatInterval(21 * DAY)).toBe("3w");
    expect(formatInterval(90 * DAY)).toBe("3mo");
    expect(formatInterval(547 * DAY)).toBe("1.5y");
  });

  it("previews each answer", () => {
    expect(previewIntervals(newCard(), NOW)).toEqual({ again: "10m", hard: "1d", good: "2d", easy: "4d" });
  });
});

describe("queue", () => {
  const cards = [
    { id: "a", order: ["B.pdf", 3] as [string, number] },
    { id: "b", order: ["A.pdf", 9] as [string, number] },
    { id: "c", order: ["A.pdf", 2] as [string, number] },
    { id: "d", order: ["A.pdf", 1] as [string, number] },
  ];
  const states: Record<string, CardState> = {
    a: { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: NOW - DAY }, // due (older)
    b: { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: NOW - MINUTE }, // due
    d: { ease: 2.5, interval: 5, reps: 2, lapses: 0, due: NOW + 2 * DAY }, // not yet
  };

  it("puts due cards first (oldest first), then new cards in reading order", () => {
    expect(buildQueue(cards, states, NOW).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("caps new cards", () => {
    expect(buildQueue(cards, {}, NOW, 2).map((c) => c.id)).toEqual(["d", "c"]);
  });

  it("counts due, new and the next due time", () => {
    expect(deckStats(cards, states, NOW)).toEqual({ due: 2, fresh: 1, total: 4, nextDue: NOW + 2 * DAY });
  });
});
