// #tags in notes and canvas text. A tag starts with a letter or _, and may
// contain letters, digits, - _ and / (for nesting, e.g. #exam/midterm).
// Headings ("# Title"), link fragments ([[x.pdf#page=2]]) and code are ignored.

export interface TagMatch {
  tag: string;
  from: number;
  to: number;
}

const TAG_RE = /(^|[\s(,;:!?"'“])#([\p{L}_][\p{L}\p{N}_\-/]*)/gu;

/** Blanks out code spans/blocks (keeping offsets) so tags inside code are skipped. */
function maskCode(text: string) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

export function parseTags(text: string, offset = 0): TagMatch[] {
  const out: TagMatch[] = [];
  for (const m of maskCode(text).matchAll(TAG_RE)) {
    const tag = m[2].replace(/[/\-_]+$/, "");
    if (!tag) continue;
    const from = offset + m.index! + m[1].length;
    out.push({ tag, from, to: from + 1 + tag.length });
  }
  return out;
}

export const tagKey = (t: string) => t.toLowerCase();

/** Distinct tags in a text, keyed case-insensitively (first spelling wins). */
export function tagsIn(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of parseTags(text)) if (!out.has(tagKey(t.tag))) out.set(tagKey(t.tag), t.tag);
  return out;
}

const VALID_TAG = /^[\p{L}_][\p{L}\p{N}_\-/]*$/u;

/** Why a tag name can't be used (or null). Accepts it with or without the leading #. */
export function validateTag(raw: string): string | null {
  const t = raw.trim().replace(/^#/, "");
  if (!t) return "Enter a tag name";
  if (!VALID_TAG.test(t)) return "Tags start with a letter and use letters, digits, - _ and / only";
  if (/[/\-_]$/.test(t) || t.includes("//")) return "A tag can't end with - _ or / (or contain //)";
  return null;
}

/**
 * Renames `old` to `next` in a text — and its nested tags with it (#exam/midterm
 * → #test/midterm). Renaming onto an existing tag merges the two.
 */
export function renameTag(text: string, old: string, next: string): string {
  const from = tagKey(old.replace(/^#/, ""));
  const to = next.replace(/^#/, "");
  const hits = parseTags(text).filter((t) => {
    const k = tagKey(t.tag);
    return k === from || k.startsWith(from + "/");
  });
  if (!hits.length) return text;
  let out = "";
  let last = 0;
  for (const h of hits) {
    out += text.slice(last, h.from) + "#" + to + h.tag.slice(from.length);
    last = h.to;
  }
  return out + text.slice(last);
}

/** True if `tags` has `tag` or a nested child of it (#exam matches #exam/midterm). */
export function hasTag(tags: Map<string, string>, tag: string) {
  const k = tagKey(tag);
  for (const key of tags.keys()) if (key === k || key.startsWith(k + "/")) return true;
  return false;
}
