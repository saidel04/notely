import { describe, expect, it } from "vitest";
import { headingAt, outline } from "./outline";

describe("outline", () => {
  it("lists ATX headings with level, text and position", () => {
    const doc = "# Title\n\nIntro\n\n## Part one\ntext\n### Detail ###\n";
    expect(outline(doc)).toEqual([
      { level: 1, text: "Title", from: 0 },
      { level: 2, text: "Part one", from: doc.indexOf("## Part") },
      { level: 3, text: "Detail", from: doc.indexOf("### Detail") },
    ]);
  });

  it("ignores # inside fenced code and requires a space after #", () => {
    const doc = "```\n# not a heading\n```\n#hashtag line\n~~~\n## nope\n~~~\n## Real";
    expect(outline(doc).map((h) => h.text)).toEqual(["Real"]);
  });

  it("supports setext headings under plain text only", () => {
    const doc = "Big title\n=========\n\nSmaller\n---\n\n- list item\n---\n";
    expect(outline(doc).map((h) => [h.level, h.text])).toEqual([
      [1, "Big title"],
      [2, "Smaller"],
    ]);
  });

  it("cleans links and emphasis from heading text", () => {
    const doc = "## About [[Cells|the cell]] and **mitosis** in `code`\n# See [docs](http://x)";
    expect(outline(doc).map((h) => h.text)).toEqual(["About the cell and mitosis in code", "See docs"]);
  });

  it("skips empty headings", () => {
    expect(outline("#\n## \n## Ok")).toEqual([{ level: 2, text: "Ok", from: 6 }]);
  });
});

describe("headingAt", () => {
  const hs = outline("# A\nx\n## B\ny\n## C\n");
  it("finds the heading a position is under", () => {
    expect(headingAt(hs, 0)).toBe(0);
    expect(headingAt(hs, 5)).toBe(0);
    expect(headingAt(hs, hs[1].from)).toBe(1);
    expect(headingAt(hs, 999)).toBe(2);
    expect(headingAt(outline("text\n# A"), 0)).toBe(-1);
  });
});
