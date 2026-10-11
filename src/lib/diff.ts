// Line diff for comparing a note with an earlier version. Pure.

export type DiffLine = { op: "same" | "add" | "del"; text: string };

/**
 * Lines removed from `a` / added in `b`, in order, via the longest common
 * subsequence. Shared head and tail are trimmed first, so typical edits to a
 * long note stay cheap; very large changes fall back to "all removed, all added".
 */
export function diffLines(a: string, b: string, maxCells = 4_000_000): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) endA--, endB--;

  const head: DiffLine[] = A.slice(0, start).map((text) => ({ op: "same", text }));
  const tail: DiffLine[] = A.slice(endA).map((text) => ({ op: "same", text }));
  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);
  const n = a2.length;
  const m = b2.length;

  let middle: DiffLine[];
  if (n * m > maxCells) {
    middle = [...a2.map((text) => ({ op: "del" as const, text })), ...b2.map((text) => ({ op: "add" as const, text }))];
  } else {
    // lcs[i][j] = LCS length of a2[i..] and b2[j..]
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = a2[i] === b2[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) middle.push({ op: "same", text: a2[i++] }), j++;
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) middle.push({ op: "del", text: a2[i++] });
      else middle.push({ op: "add", text: b2[j++] });
    }
    while (i < n) middle.push({ op: "del", text: a2[i++] });
    while (j < m) middle.push({ op: "add", text: b2[j++] });
  }
  return [...head, ...middle, ...tail];
}

/** Counts of added and removed lines. */
export function diffStats(d: DiffLine[]) {
  let added = 0;
  let removed = 0;
  for (const l of d) {
    if (l.op === "add") added++;
    else if (l.op === "del") removed++;
  }
  return { added, removed };
}

/**
 * The diff with long runs of unchanged lines folded to a few lines of context
 * around each change ({ op: "skip", count } marks a fold).
 */
export function foldUnchanged(d: DiffLine[], context = 2): (DiffLine | { op: "skip"; count: number })[] {
  const keep = new Array(d.length).fill(false);
  d.forEach((l, i) => {
    if (l.op === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | { op: "skip"; count: number })[] = [];
  let skipped = 0;
  d.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ op: "skip", count: skipped });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ op: "skip", count: skipped });
  return out;
}
