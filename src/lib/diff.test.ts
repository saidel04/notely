import { describe, expect, it } from "vitest";
import { diffLines, diffStats, foldUnchanged } from "./diff";

const ops = (a: string, b: string) => diffLines(a, b).map((l) => `${l.op === "same" ? " " : l.op === "add" ? "+" : "-"}${l.text}`);

describe("diffLines", () => {
  it("finds added, removed and changed lines", () => {
    expect(ops("a\nb\nc", "a\nB\nc\nd")).toEqual([" a", "-b", "+B", " c", "+d"]);
  });

  it("handles identical, empty and fully different texts", () => {
    expect(ops("x\ny", "x\ny")).toEqual([" x", " y"]);
    expect(ops("", "new")).toEqual(["-", "+new"]);
    expect(diffStats(diffLines("a\nb", "c\nd"))).toEqual({ added: 2, removed: 2 });
  });

  it("keeps lines in order when a block moves", () => {
    const d = diffLines("1\n2\n3\n4", "3\n4\n1\n2");
    expect(diffStats(d)).toEqual({ added: 2, removed: 2 });
    expect(d.filter((l) => l.op !== "del").map((l) => l.text)).toEqual(["3", "4", "1", "2"]);
  });

  it("falls back gracefully for huge changes", () => {
    const d = diffLines("a\nb\nc", "x\ny\nz", 4);
    expect(d.map((l) => l.op)).toEqual(["del", "del", "del", "add", "add", "add"]);
  });
});

describe("foldUnchanged", () => {
  it("folds long unchanged runs, keeping context around changes", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l10", "L10");
    const f = foldUnchanged(diffLines(a, b), 1);
    expect(f.map((x) => (x.op === "skip" ? `…${x.count}` : x.op === "same" ? x.text : `${x.op}:${x.text}`))).toEqual([
      "…9",
      "l9",
      "del:l10",
      "add:L10",
      "l11",
      "…8",
    ]);
  });
});
