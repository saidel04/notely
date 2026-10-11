import { describe, expect, it } from "vitest";
import { appendCards, cardId, cardLine, parseDeck } from "./flashcards";

describe("parseDeck", () => {
  it("reads one card per line", () => {
    const d = parseDeck("Capital of France?: Paris\nLargest planet?: Jupiter");
    expect(d.cards.map((c) => [c.question, c.answer])).toEqual([
      ["Capital of France?", "Paris"],
      ["Largest planet?", "Jupiter"],
    ]);
    expect(d.cards.map((c) => c.line)).toEqual([1, 2]);
    expect(d.problems).toEqual([]);
  });

  it("skips blank lines and # comments", () => {
    const d = parseDeck("# Chapter 1\n\nQ: A\n   \n# Q: not a card");
    expect(d.cards.map((c) => c.question)).toEqual(["Q"]);
    expect(d.cards[0].line).toBe(3);
  });

  it("splits at the first colon, so answers may contain colons", () => {
    const d = parseDeck("Define osmosis: movement of water: across a membrane");
    expect(d.cards[0]).toMatchObject({ question: "Define osmosis", answer: "movement of water: across a membrane" });
  });

  it("allows an escaped colon in the question", () => {
    const d = parseDeck("Reaction A\\: B?: it reverses");
    expect(d.cards[0]).toMatchObject({ question: "Reaction A: B?", answer: "it reverses" });
  });

  it("reports lines that are not cards instead of dropping them", () => {
    const d = parseDeck("Q: A\njust some text\nhalf a card:");
    expect(d.cards).toHaveLength(1);
    expect(d.problems).toEqual([
      { line: 2, text: "just some text" },
      { line: 3, text: "half a card:" },
    ]);
  });

  it("keeps a repeated question once", () => {
    const d = parseDeck("Q: first\nq : second");
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0].answer).toBe("first");
  });
});

describe("cardId", () => {
  it("ignores case and spacing, so progress survives tidying up", () => {
    expect(cardId("What is  ATP?")).toBe(cardId("what is atp?"));
  });

  it("differs for different questions", () => {
    expect(cardId("What is ATP?")).not.toBe(cardId("What is ADP?"));
  });
});

describe("writing", () => {
  it("escapes a colon in the question", () => {
    expect(cardLine("Note: sodium", "Na")).toBe("Note\\: sodium: Na");
    expect(parseDeck(cardLine("Note: sodium", "Na")).cards[0].question).toBe("Note: sodium");
  });

  it("appends cards after the existing ones", () => {
    expect(appendCards("Q: A\n\n", ["R: B"])).toBe("Q: A\nR: B\n");
    expect(appendCards("", ["R: B"])).toBe("R: B\n");
  });
});
