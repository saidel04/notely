import { describe, expect, it } from "vitest";
import { parseCopiedLink } from "./links";

describe("parseCopiedLink", () => {
  it("accepts exactly one copied link", () => {
    expect(parseCopiedLink("  [[paper.pdf#hl-ab12cd]] ")).toMatchObject({ target: "paper.pdf", fragment: "hl-ab12cd" });
    expect(parseCopiedLink("[[Note]]")).toMatchObject({ target: "Note", kind: "note" });
  });

  it("rejects ordinary text or several links", () => {
    expect(parseCopiedLink("see [[Note]]")).toBeNull();
    expect(parseCopiedLink("[[A]] [[B]]")).toBeNull();
    expect(parseCopiedLink("plain words")).toBeNull();
  });
});
