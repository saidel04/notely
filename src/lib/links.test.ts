import { describe, expect, it } from "vitest";
import { displayText, findBacklinks, formatLink, parseLinks, qualify, rewriteLinks, rewriteNotebookPrefix } from "./links";

describe("parseLinks", () => {
  it("parses notes, aliases, pdfs, pages and highlights", () => {
    const text = "See [[Cells]], [[Cells|the cell note]], [[paper.pdf]], [[paper.pdf#page=4]] and [[Paper.PDF#hl-ab12cd]].";
    const links = parseLinks(text);
    expect(links.map((l) => [l.target, l.kind, l.alias, l.page, l.highlightId])).toEqual([
      ["Cells", "note", null, null, null],
      ["Cells", "note", "the cell note", null, null],
      ["paper.pdf", "pdf", null, null, null],
      ["paper.pdf", "pdf", null, 4, null],
      ["Paper.PDF", "pdf", null, null, "hl-ab12cd"],
    ]);
    expect(text.slice(links[0].from, links[0].to)).toBe("[[Cells]]");
  });

  it("ignores empty or unclosed links and applies offsets", () => {
    expect(parseLinks("[[]] [[open")).toEqual([]);
    expect(parseLinks("x [[A]]", 10)[0].from).toBe(12);
  });
});

describe("rewriteLinks", () => {
  it("renames targets case-insensitively and keeps fragments/aliases", () => {
    const text = "[[old]] [[Old|alias]] [[Older]] [[old#x]]";
    expect(rewriteLinks(text, "Old", "New")).toBe("[[New]] [[New|alias]] [[Older]] [[New#x]]");
  });

  it("renames pdf links with highlight fragments", () => {
    expect(rewriteLinks("[[a.pdf#hl-1]]", "a.pdf", "b.pdf")).toBe("[[b.pdf#hl-1]]");
  });

  it("returns text unchanged when nothing matches", () => {
    expect(rewriteLinks("plain", "a", "b")).toBe("plain");
  });
});

describe("canvas links and embeds", () => {
  it("parses canvas links and embeds", () => {
    const [plain, embed] = parseLinks("[[Flow.canvas]] then ![[Flow.canvas|diagram]]");
    expect(plain).toMatchObject({ kind: "canvas", embed: false, target: "Flow.canvas" });
    expect(embed).toMatchObject({ kind: "canvas", embed: true, alias: "diagram", from: 21 });
    expect(embed.raw).toBe("![[Flow.canvas|diagram]]");
  });

  it("keeps the ! when renaming an embedded target", () => {
    expect(rewriteLinks("![[A.canvas]] [[A.canvas]]", "A.canvas", "B.canvas")).toBe("![[B.canvas]] [[B.canvas]]");
  });
});

describe("cross-notebook links", () => {
  it("splits the notebook prefix", () => {
    const [a, b, c] = parseLinks("[[Biology/Cells]] [[Bio/paper.pdf#hl-x|why]] [[Local]]");
    expect(a).toMatchObject({ notebook: "Biology", name: "Cells", kind: "note", target: "Biology/Cells" });
    expect(b).toMatchObject({ notebook: "Bio", name: "paper.pdf", kind: "pdf", highlightId: "hl-x", alias: "why" });
    expect(c).toMatchObject({ notebook: null, name: "Local" });
    expect(displayText(a)).toBe("Cells");
  });

  it("qualifies targets and rewrites notebook prefixes", () => {
    expect(qualify("Cells", "Bio", "Bio")).toBe("Cells");
    expect(qualify("Cells", "Bio", "Chem")).toBe("Bio/Cells");
    expect(rewriteNotebookPrefix("[[bio/Cells|c]] ![[Bio/X.canvas]] [[Other/Y]] [[Z]]", "Bio", "Biology")).toBe(
      "[[Biology/Cells|c]] ![[Biology/X.canvas]] [[Other/Y]] [[Z]]",
    );
  });
});

describe("helpers", () => {
  it("finds backlinks excluding self", () => {
    const contents = { A: "[[B]]", B: "[[b]] self", C: "[[b|x]]", D: "none" };
    expect(findBacklinks(contents, "B", "B")).toEqual(["A", "C"]);
  });

  it("formats and displays links", () => {
    expect(formatLink("p.pdf", "page=2", "intro")).toBe("[[p.pdf#page=2|intro]]");
    const [page, hl] = parseLinks("[[p.pdf#page=2]] [[p.pdf#hl-x]]");
    expect(displayText(page)).toBe("p · p. 2");
    expect(displayText(hl, "short quote")).toBe("“short quote”");
  });
});
