import { describe, expect, it } from "vitest";
import { hasTag, parseTags, renameTag, tagsIn, validateTag } from "./tags";

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

describe("renameTag", () => {
  it("renames a tag and its nested tags, case-insensitively", () => {
    expect(renameTag("Read #Exam and #exam/midterm, not #examples.", "exam", "test")).toBe("Read #test and #test/midterm, not #examples.");
  });

  it("merges into an existing tag and leaves code, headings and links alone", () => {
    const text = "# exam\n#exam `#exam` [[p.pdf#exam]] #test";
    expect(renameTag(text, "#exam", "#test")).toBe("# exam\n#test `#exam` [[p.pdf#exam]] #test");
  });

  it("can move a tag under another (nest it)", () => {
    expect(renameTag("#midterm and #midterm/q1", "midterm", "exam/midterm")).toBe("#exam/midterm and #exam/midterm/q1");
  });

  it("returns the same string when nothing matches", () => {
    const t = "no tags here #other";
    expect(renameTag(t, "exam", "test")).toBe(t);
  });
});

describe("validateTag", () => {
  it("accepts tag names with or without #", () => {
    expect(validateTag("#exam/midterm")).toBeNull();
    expect(validateTag("économie")).toBeNull();
  });
  it("rejects empty, numeric-first, spaced and dangling names", () => {
    for (const bad of ["", "#", "1st", "two words", "exam/", "a//b", "x-"]) expect(validateTag(bad)).not.toBeNull();
  });
});
