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

/** True if `tags` has `tag` or a nested child of it (#exam matches #exam/midterm). */
export function hasTag(tags: Map<string, string>, tag: string) {
  const k = tagKey(tag);
  for (const key of tags.keys()) if (key === k || key.startsWith(k + "/")) return true;
  return false;
}
