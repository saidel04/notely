import { describe, expect, it } from "vitest";
import { hasTag, parseTags, tagsIn } from "./tags";

describe("parseTags", () => {
  it("finds tags and their positions", () => {
    const t = parseTags("Read this #exam soon (#review) and #exam/midterm.");
    expect(t.map((x) => x.tag)).toEqual(["exam", "review", "exam/midterm"]);
    expect("Read this #exam soon".slice(t[0].from, t[0].to)).toBe("#exam");
  });

  it("ignores headings, link fragments, numbers, code and URLs", () => {
    const text = "# Heading\n[[p.pdf#page=2]] [[n#hl-x]] #123 `#code` http://x.com/#anchor\n```\n#block\n```\n#real";
    expect(parseTags(text).map((x) => x.tag)).toEqual(["real"]);
  });

  it("supports non-English letters", () => {
    expect(parseTags("#économie #历史").map((x) => x.tag)).toEqual(["économie", "历史"]);
  });
});

describe("tag sets", () => {
  it("dedupes case-insensitively and matches nested tags", () => {
    const tags = tagsIn("#Exam #exam #exam/midterm");
    expect([...tags.values()]).toEqual(["Exam", "exam/midterm"]);
    expect(hasTag(tags, "exam")).toBe(true);
    expect(hasTag(tags, "EXAM/MIDTERM")).toBe(true);
    expect(hasTag(tags, "ex")).toBe(false);
  });
});
