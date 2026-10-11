import { describe, expect, it } from "vitest";
import { buildPageText, findInPages, matchRects, snippet } from "./pdfText";

describe("buildPageText", () => {
  it("joins items and turns line ends into spaces", () => {
    const { text, spans } = buildPageText([
      { str: "Siege", hasEOL: false },
      { str: " ", hasEOL: false },
      { str: "warfare", hasEOL: true },
      { str: "in Greece", hasEOL: false },
    ]);
    expect(text).toBe("Siege warfare in Greece");
    expect(spans.map((s) => [s[0], s[1]])).toEqual([[0, 5], [5, 6], [6, 13], [14, 23]]);
  });
});

describe("findInPages", () => {
  it("is case-insensitive, whitespace-tolerant and reports pages", () => {
    const pages = ["The SIEGE of", "a long  siege\nlasted", "nothing"];
    expect(findInPages(pages, "siege")).toEqual([
      { page: 1, start: 4, end: 9 },
      { page: 2, start: 8, end: 13 },
    ]);
    expect(findInPages(pages, "long siege")).toEqual([{ page: 2, start: 2, end: 13 }]);
  });

  it("escapes regex characters and ignores empty queries", () => {
    expect(findInPages(["cost (2) items"], "(2)")).toHaveLength(1);
    expect(findInPages(["x"], "   ")).toEqual([]);
  });
});

describe("matchRects / snippet", () => {
  // A horizontal item: top-left (0.1, 0.2), width 0.5, height 0.02.
  const horizontal = {
    text: "abcdefghij",
    items: [{ start: 0, end: 10, tx: 0.1, ty: 0.2, bx: 0.1, by: 0.22, dx: 0.5, dy: 0 }],
  };

  it("interpolates a range within a horizontal item", () => {
    const [r] = matchRects(3, horizontal, 2, 7);
    expect(r.page).toBe(3);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.w).toBeCloseTo(0.25);
    expect(r.y).toBeCloseTo(0.2);
    expect(r.h).toBeCloseTo(0.02);
  });

  it("bounds a slice of a rotated item (baseline running downward)", () => {
    // Baseline goes straight down from (0.5, 0.1); glyph box is 0.02 wide to the left.
    const vertical = {
      text: "abcdefghij",
      items: [{ start: 0, end: 10, tx: 0.5, ty: 0.1, bx: 0.52, by: 0.1, dx: 0, dy: 0.5 }],
    };
    const [r] = matchRects(1, vertical, 0, 5); // first half
    expect(r.x).toBeCloseTo(0.5);
    expect(r.w).toBeCloseTo(0.02);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.h).toBeCloseTo(0.25); // half the baseline length
  });

  it("builds a trimmed snippet around a match", () => {
    expect(snippet("one two three four", 4, 7, 4)).toEqual({ before: "one ", match: "two", after: " thr…" });
  });
});
