// Citations for the PDFs a note cites: APA 7 and BibTeX. Pure formatting —
// metadata comes from the PDF (title/author/date) with the file name as a
// fallback, since many PDFs carry poor or no metadata.

export interface SourceMeta {
  /** The PDF's file name (always known). */
  file: string;
  title: string | null;
  /** Authors as written, e.g. ["David Whitehead"] or ["Whitehead, David"]. */
  authors: string[];
  year: number | null;
  pages: number | null;
}

/** "Title (Author).pdf" → { title, author } — the trailing (balanced) parenthetical is the author. */
export function parseFileName(file: string): { title: string; author: string | null } {
  const base = file.replace(/\.pdf$/i, "").trim();
  if (base.endsWith(")")) {
    let depth = 0;
    for (let i = base.length - 1; i >= 0; i--) {
      if (base[i] === ")") depth++;
      else if (base[i] === "(" && --depth === 0) {
        const title = base.slice(0, i).trim();
        const author = base.slice(i + 1, -1).trim();
        // "(2nd ed)" or "(1)" aren't authors.
        if (title && author && /[a-z]{2}/i.test(author) && !/\b(ed|edition|vol|v\d)\b|^\d+$/i.test(author)) return { title, author };
        break;
      }
    }
  }
  return { title: base, author: null };
}

/** Splits an author field: "A; B", "A and B", "A & B" (commas are kept: "Last, First"). */
export function splitAuthors(raw: string): string[] {
  return raw
    .split(/\s*;\s*|\s+and\s+|\s*&\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** The year from a PDF date ("D:20120315120000+01'00'") or an ISO date. */
export function yearOf(date: string | null | undefined): number | null {
  const m = /^(?:D:)?(\d{4})/.exec(date?.trim() ?? "");
  const y = m ? Number(m[1]) : NaN;
  return y >= 1450 && y <= 2100 ? y : null;
}

function nameParts(name: string): { last: string; given: string[] } {
  const n = name.replace(/\s+/g, " ").trim();
  if (n.includes(",")) {
    const [last, given] = n.split(",", 2);
    return { last: last.trim(), given: given.trim().split(" ").filter(Boolean) };
  }
  const words = n.split(" ");
  // Keep particles with the surname: "Ludwig van Beethoven" → "van Beethoven".
  let cut = words.length - 1;
  while (cut > 1 && /^(van|von|de|der|da|di|del|la|le|du|ten|ter)$/i.test(words[cut - 1])) cut--;
  return { last: words.slice(cut).join(" "), given: words.slice(0, cut) };
}

const initials = (given: string[]) =>
  given
    .map((g) =>
      g
        .split("-")
        .map((p) => (p ? `${p[0].toUpperCase()}.` : ""))
        .join("-"),
    )
    .join(" ");

/** "David Whitehead" → "Whitehead, D." */
export function apaName(name: string): string {
  const { last, given } = nameParts(name);
  return given.length ? `${last}, ${initials(given)}` : last;
}

/** APA author list: "A, B., & C, D." (up to 20 names). */
export function apaAuthors(authors: string[]): string {
  const names = authors.slice(0, 20).map(apaName);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

const sentenceEnd = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** One APA 7 reference (Markdown, title in italics). */
export function formatApa(m: SourceMeta): string {
  const fallback = parseFileName(m.file);
  const title = (m.title ?? fallback.title).trim();
  const authors = m.authors.length ? m.authors : fallback.author ? splitAuthors(fallback.author) : [];
  const year = m.year ? String(m.year) : "n.d.";
  if (!authors.length) return `*${sentenceEnd(title)}* (${year}).`;
  return `${sentenceEnd(apaAuthors(authors))} (${year}). *${sentenceEnd(title)}*`;
}

const ascii = (s: string) => s.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
const STOP = new Set(["a", "an", "the", "on", "of", "in", "to", "and", "for", "how"]);

/** "whitehead2002aineias" — surname, year, first significant title word. */
export function bibKey(m: SourceMeta): string {
  const fallback = parseFileName(m.file);
  const author = m.authors[0] ?? (fallback.author ? splitAuthors(fallback.author)[0] : "");
  const last = author ? ascii(nameParts(author).last).toLowerCase().replace(/[^a-z]/g, "") : "";
  const word = ascii(m.title ?? fallback.title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((w) => w && !STOP.has(w));
  return `${last || "anon"}${m.year ?? ""}${word ?? ""}` || "source";
}

/** Escapes LaTeX specials so titles survive BibTeX. */
const tex = (s: string) => s.replace(/[\\{}]/g, "").replace(/([&%$#_])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");

/** One BibTeX entry: @book for long documents, @misc otherwise. */
export function formatBibtex(m: SourceMeta, key = bibKey(m)): string {
  const fallback = parseFileName(m.file);
  const authors = m.authors.length ? m.authors : fallback.author ? splitAuthors(fallback.author) : [];
  const fields: [string, string][] = [["title", m.title ?? fallback.title]];
  const bibName = (a: string) => {
    const p = nameParts(a);
    return p.given.length ? `${p.last}, ${p.given.join(" ")}` : p.last;
  };
  if (authors.length) fields.push(["author", authors.map(bibName).join(" and ")]);
  if (m.year) fields.push(["year", String(m.year)]);
  if (m.pages && m.pages < 50) fields.push(["howpublished", "PDF"]);
  fields.push(["note", `File: ${m.file}`]);
  const type = m.pages && m.pages >= 50 ? "book" : "misc";
  return `@${type}{${key},\n${fields.map(([k, v]) => `  ${k} = {${tex(v)}}`).join(",\n")}\n}`;
}

/** BibTeX for several sources, with duplicate keys made unique (…a, …b). */
export function formatBibliography(sources: SourceMeta[]): string {
  const seen = new Map<string, number>();
  return sources
    .map((m) => {
      const base = bibKey(m);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return formatBibtex(m, n ? `${base}${String.fromCharCode(96 + n + 1)}` : base);
    })
    .join("\n\n");
}

/** APA reference list, alphabetical as APA requires. */
export function formatApaList(sources: SourceMeta[]): string[] {
  return sources.map(formatApa).sort((a, b) => a.replace(/^\*/, "").localeCompare(b.replace(/^\*/, ""), undefined, { sensitivity: "base" }));
}
