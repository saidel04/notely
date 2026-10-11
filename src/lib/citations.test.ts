import { describe, expect, it } from "vitest";
import { apaAuthors, apaName, bibKey, formatApa, formatApaList, formatBibliography, formatBibtex, parseFileName, SourceMeta, splitAuthors, yearOf } from "./citations";

const meta = (m: Partial<SourceMeta>): SourceMeta => ({ file: "x.pdf", title: null, authors: [], year: null, pages: null, ...m });

describe("file names and fields", () => {
  it("takes the trailing (balanced) parenthetical as the author", () => {
    expect(parseFileName("Aineias the Tactician How to Survive Under Siege (David Whitehead Aeneas (Tacticus)).pdf")).toEqual({
      title: "Aineias the Tactician How to Survive Under Siege",
      author: "David Whitehead Aeneas (Tacticus)",
    });
    expect(parseFileName("Biology (2nd edition).pdf")).toEqual({ title: "Biology (2nd edition)", author: null });
    expect(parseFileName("Notes (3).pdf").author).toBeNull();
    expect(parseFileName("plain.pdf")).toEqual({ title: "plain", author: null });
  });

  it("splits authors on ; and/& but not on the comma of 'Last, First'", () => {
    expect(splitAuthors("Whitehead, David; Smith, Jane")).toEqual(["Whitehead, David", "Smith, Jane"]);
    expect(splitAuthors("Ann Lee and Bo Kim & Cy Ng")).toEqual(["Ann Lee", "Bo Kim", "Cy Ng"]);
  });

  it("reads years from PDF and ISO dates", () => {
    expect(yearOf("D:20120315120000+01'00'")).toBe(2012);
    expect(yearOf("2001-04-02")).toBe(2001);
    expect(yearOf("D:00000101")).toBeNull();
    expect(yearOf(undefined)).toBeNull();
  });
});

describe("APA", () => {
  it("formats names with initials and particles", () => {
    expect(apaName("David Whitehead")).toBe("Whitehead, D.");
    expect(apaName("Whitehead, David M.")).toBe("Whitehead, D. M.");
    expect(apaName("Jean-Paul Sartre")).toBe("Sartre, J.-P.");
    expect(apaName("Ludwig van Beethoven")).toBe("van Beethoven, L.");
    expect(apaName("Plato")).toBe("Plato");
  });

  it("joins authors with an ampersand before the last", () => {
    expect(apaAuthors(["Ann Lee"])).toBe("Lee, A.");
    expect(apaAuthors(["Ann Lee", "Bo Kim"])).toBe("Lee, A., & Kim, B.");
    expect(apaAuthors(["Ann Lee", "Bo Kim", "Cy Ng"])).toBe("Lee, A., Kim, B., & Ng, C.");
  });

  it("builds references, falling back to the file name and n.d.", () => {
    expect(formatApa(meta({ title: "How to Survive Under Siege", authors: ["David Whitehead"], year: 2002 }))).toBe(
      "Whitehead, D. (2002). *How to Survive Under Siege.*",
    );
    expect(formatApa(meta({ file: "Cell Biology (Jane Smith).pdf" }))).toBe("Smith, J. (n.d.). *Cell Biology.*");
    expect(formatApa(meta({ file: "Untitled notes.pdf", year: 2020 }))).toBe("*Untitled notes.* (2020).");
    expect(formatApa(meta({ title: "Why?", authors: ["A B"] }))).toBe("B, A. (n.d.). *Why?*");
  });

  it("sorts a reference list alphabetically", () => {
    const list = formatApaList([meta({ file: "Zoo (Zed Zane).pdf" }), meta({ file: "Apple (Amy Ash).pdf" }), meta({ file: "Middle.pdf" })]);
    expect(list.map((l) => l.slice(0, 6))).toEqual(["Ash, A", "*Middl", "Zane, "]);
  });
});

describe("BibTeX", () => {
  const book = meta({ file: "Siege.pdf", title: "Aineias the Tactician: How to Survive Under Siege", authors: ["David Whitehead"], year: 2002, pages: 240 });

  it("makes readable keys", () => {
    expect(bibKey(book)).toBe("whitehead2002aineias");
    expect(bibKey(meta({ file: "The Art of War.pdf" }))).toBe("anonart");
  });

  it("formats an entry, escaping LaTeX specials", () => {
    expect(formatBibtex(book)).toBe(
      "@book{whitehead2002aineias,\n  title = {Aineias the Tactician: How to Survive Under Siege},\n  author = {Whitehead, David},\n  year = {2002},\n  note = {File: Siege.pdf}\n}",
    );
    const misc = formatBibtex(meta({ file: "a_b.pdf", title: "Profit & Loss 100%", authors: ["Ann Lee", "Bo Kim"], pages: 3 }));
    expect(misc).toContain("@misc{");
    expect(misc).toContain("title = {Profit \\& Loss 100\\%}");
    expect(misc).toContain("author = {Lee, Ann and Kim, Bo}");
    expect(misc).toContain("note = {File: a\\_b.pdf}");
  });

  it("keeps keys unique across a bibliography", () => {
    const bib = formatBibliography([book, { ...book, file: "Siege 2.pdf" }]);
    expect(bib.match(/@book\{[^,]+/g)).toEqual(["@book{whitehead2002aineias", "@book{whitehead2002aineiasb"]);
  });
});
