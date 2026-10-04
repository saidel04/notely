// Wiki-link parsing shared by the editor, autocomplete, backlinks and renames.
//
//   [[Note name]]            note
//   [[Note name|alias]]      note, displayed as "alias"
//   [[file.pdf]]             pdf
//   [[file.pdf#page=12]]     pdf page
//   [[file.pdf#hl-ab12cd]]   pdf highlight
//   [[file.pdf#bm-ab12cd]]   pdf bookmark
//   [[Diagram.canvas]]       canvas
//   ![[Diagram.canvas]]      canvas embedded as a preview
//   [[Biology/Cells]]        anything in another notebook: prefix "Notebook/"

export type LinkKind = "note" | "pdf" | "canvas";

export interface WikiLink {
  from: number;
  to: number;
  raw: string;
  /** Exactly as written, including any "Notebook/" prefix. */
  target: string;
  /** Notebook named in the link ("Biology" in [[Biology/Cells]]), or null for the current one. */
  notebook: string | null;
  /** The item name without the notebook prefix. */
  name: string;
  fragment: string | null;
  alias: string | null;
  kind: LinkKind;
  page: number | null;
  highlightId: string | null;
  bookmarkId: string | null;
  /** `![[…]]`: render the target inline (canvases show a preview). */
  embed: boolean;
}

const LINK_RE = /\[\[([^[\]|#\n]+?)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;

export function isPdfName(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

export function isCanvasName(name: string) {
  return name.toLowerCase().endsWith(".canvas");
}

/** "Biology/Cells" → { notebook: "Biology", name: "Cells" }; names can't contain "/", so the first one separates. */
export function splitTarget(target: string): { notebook: string | null; name: string } {
  const i = target.indexOf("/");
  if (i <= 0) return { notebook: null, name: target.trim() };
  return { notebook: target.slice(0, i).trim(), name: target.slice(i + 1).trim() };
}

/** Target string for an item, qualified with its notebook when that isn't the current one. */
export function qualify(name: string, notebook: string, current: string | null) {
  return current && sameName(notebook, current) ? name : `${notebook}/${name}`;
}

/** Rewrites links into notebook `old` so they point into `next` (after a notebook rename). */
export function rewriteNotebookPrefix(text: string, old: string, next: string): string {
  const links = parseLinks(text).filter((l) => l.notebook && sameName(l.notebook, old));
  if (!links.length) return text;
  let out = "";
  let last = 0;
  for (const l of links) {
    out += text.slice(last, l.from) + formatLink(`${next}/${l.name}`, l.fragment, l.alias, l.embed);
    last = l.to;
  }
  return out + text.slice(last);
}

/** "Flow.canvas" → "Flow" */
export const canvasBase = (name: string) => name.replace(/\.canvas$/i, "");

export function parseLinks(text: string, offset = 0): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    const { notebook, name } = splitTarget(target);
    if (!name) continue;
    const fragment = m[2]?.trim() || null;
    const kind: LinkKind = isPdfName(name) ? "pdf" : isCanvasName(name) ? "canvas" : "note";
    let page: number | null = null;
    let highlightId: string | null = null;
    let bookmarkId: string | null = null;
    if (kind === "pdf" && fragment) {
      const pm = /^page=(\d+)$/i.exec(fragment);
      if (pm) page = Math.max(1, parseInt(pm[1], 10));
      else if (/^hl-[a-z0-9]+$/i.test(fragment)) highlightId = fragment;
      else if (/^bm-[a-z0-9]+$/i.test(fragment)) bookmarkId = fragment;
    }
    const embed = m.index! > 0 && text[m.index! - 1] === "!";
    out.push({
      from: offset + m.index! - (embed ? 1 : 0),
      to: offset + m.index! + m[0].length,
      raw: (embed ? "!" : "") + m[0],
      target,
      notebook,
      name,
      fragment,
      alias: m[3]?.trim() || null,
      kind,
      page,
      highlightId,
      bookmarkId,
      embed,
    });
  }
  return out;
}

/** If `text` is exactly one copied link, returns it (for "paste a link onto selected words"). */
export function parseCopiedLink(text: string) {
  const t = text.trim();
  const links = parseLinks(t);
  if (links.length !== 1 || links[0].raw !== t) return null;
  return links[0];
}

export function formatLink(target: string, fragment?: string | null, alias?: string | null, embed = false) {
  return `${embed ? "!" : ""}[[${target}${fragment ? `#${fragment}` : ""}${alias ? `|${alias}` : ""}]]`;
}

export const sameName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/** Rewrites every link pointing at `oldTarget` so it points at `newTarget`. */
export function rewriteLinks(text: string, oldTarget: string, newTarget: string): string {
  const links = parseLinks(text).filter((l) => sameName(l.target, oldTarget));
  if (links.length === 0) return text;
  let out = "";
  let last = 0;
  for (const l of links) {
    out += text.slice(last, l.from) + formatLink(newTarget, l.fragment, l.alias, l.embed);
    last = l.to;
  }
  return out + text.slice(last);
}

/** Names of notes (keys of `contents`) that link to `target`. */
export function findBacklinks(contents: Record<string, string>, target: string, self?: string) {
  return Object.entries(contents)
    .filter(([name, text]) => {
      if (self && sameName(name, self)) return false;
      return parseLinks(text).some((l) => sameName(l.target, target));
    })
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

export function displayText(link: WikiLink, highlightText?: string) {
  if (link.alias) return link.alias;
  const base = link.kind === "pdf" ? link.name.replace(/\.pdf$/i, "") : link.kind === "canvas" ? canvasBase(link.name) : link.name;
  if (link.page) return `${base} · p. ${link.page}`;
  if (link.bookmarkId) return highlightText ? `${base} · ${highlightText}` : `${base} · bookmark`;
  if (link.highlightId) {
    if (!highlightText) return `${base} · highlight`;
    const snip = highlightText.length > 48 ? highlightText.slice(0, 46).trimEnd() + "…" : highlightText;
    return `“${snip}”`;
  }
  return base;
}
