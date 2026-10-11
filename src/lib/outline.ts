// The heading outline of a note. Pure; shared by the outline panel and tests.

import { displayText, parseLinks } from "./links";

export interface Heading {
  level: number;
  text: string;
  /** Offset of the heading line's start in the document. */
  from: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

/** Heading text as it reads: links become their text, emphasis and code marks go. */
function clean(raw: string) {
  const withLinks = parseLinks(raw)
    .reverse()
    .reduce((s, l) => s.slice(0, l.from) + displayText(l) + s.slice(l.to), raw);
  return withLinks
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
    .trim();
}

export function outline(doc: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  let offset = 0;
  let prev: { text: string; from: number; plain: boolean } | null = null;
  for (const line of doc.split("\n")) {
    const from = offset;
    offset += line.length + 1;
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      prev = null;
      continue;
    }
    if (f) {
      fence = f[1];
      prev = null;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      const text = clean(atx[2] ?? "");
      if (text) out.push({ level: atx[1].length, text, from });
      prev = null;
      continue;
    }
    // "Title" underlined with === or --- (only directly under a plain text line).
    const setext = SETEXT.exec(line);
    if (setext && prev?.plain) {
      out.push({ level: setext[1][0] === "=" ? 1 : 2, text: clean(prev.text), from: prev.from });
      prev = null;
      continue;
    }
    const plain = !!line.trim() && !/^\s*([-*+>]|\d+[.)])\s/.test(line) && !/^\s{4}/.test(line);
    prev = { text: line, from, plain };
  }
  return out;
}

/** Index of the heading a position falls under (-1 before the first heading). */
export function headingAt(headings: Heading[], pos: number): number {
  let i = -1;
  for (let k = 0; k < headings.length && headings[k].from <= pos; k++) i = k;
  return i;
}
