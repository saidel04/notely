// Canvas undo/redo as per-element patches rather than whole-document snapshots.
//
// Each step records, for every node/edge it touched, the value before and after.
// Undoing only reverts elements that still hold the "after" value, so edits that
// arrived in between from elsewhere (an agent, another app, a sync tool) are kept
// instead of being silently rolled back.

import type { CanvasData, CanvasEdge, CanvasNode } from "./canvas";

interface Change<T> {
  id: string;
  before: T | null;
  after: T | null;
  /** Position in the list before the change, so re-added items keep their stacking order. */
  index: number;
}

export interface CanvasPatch {
  nodes: Change<CanvasNode>[];
  edges: Change<CanvasEdge>[];
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function diffList<T extends { id: string }>(before: T[], after: T[]): Change<T>[] {
  const out: Change<T>[] = [];
  const prev = new Map(before.map((x, i) => [x.id, { x, i }]));
  const next = new Map(after.map((x) => [x.id, x]));
  for (const [id, { x, i }] of prev) {
    const n = next.get(id) ?? null;
    if (!n || !deepEqual(x, n)) out.push({ id, before: x, after: n, index: i });
  }
  after.forEach((x, i) => {
    if (!prev.has(x.id)) out.push({ id: x.id, before: null, after: x, index: i });
  });
  return out;
}

export function diffCanvas(before: CanvasData, after: CanvasData): CanvasPatch {
  return { nodes: diffList(before.nodes, after.nodes), edges: diffList(before.edges, after.edges) };
}

export const isEmptyPatch = (p: CanvasPatch) => p.nodes.length === 0 && p.edges.length === 0;

function applyList<T extends { id: string }>(list: T[], changes: Change<T>[], undo: boolean): T[] {
  const out = [...list];
  // Re-insert in ascending original order so indexes line up.
  const ordered = [...changes].sort((a, b) => a.index - b.index);
  for (const c of ordered) {
    const expect = undo ? c.after : c.before;
    const want = undo ? c.before : c.after;
    const at = out.findIndex((x) => x.id === c.id);
    const current = at === -1 ? null : out[at];
    // Changed by someone else since: leave their version alone.
    if (!deepEqual(current, expect)) continue;
    if (want === null) out.splice(at, 1);
    else if (at === -1) out.splice(Math.min(c.index, out.length), 0, want);
    else out[at] = want;
  }
  return out;
}

/** Applies a patch backwards (undo) or forwards (redo) onto the current canvas. */
export function applyPatch(current: CanvasData, patch: CanvasPatch, undo: boolean): CanvasData {
  const nodes = applyList(current.nodes, patch.nodes, undo);
  const ids = new Set(nodes.map((n) => n.id));
  // An edge can't outlive a node that was removed elsewhere in the meantime.
  const edges = applyList(current.edges, patch.edges, undo).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  return { ...current, nodes, edges };
}

// ---------- per-canvas history, kept for the whole app session ----------

interface Stacks {
  undo: CanvasPatch[];
  redo: CanvasPatch[];
}
const LIMIT = 200;
const stacks = new Map<string, Stacks>();
const keyOf = (notebook: string, name: string) => `${notebook}/${name}`.toLowerCase();
const get = (k: string) => stacks.get(k) ?? stacks.set(k, { undo: [], redo: [] }).get(k)!;

export const canvasHistory = {
  record(notebook: string, name: string, before: CanvasData, after: CanvasData) {
    const patch = diffCanvas(before, after);
    if (isEmptyPatch(patch)) return;
    const s = get(keyOf(notebook, name));
    s.undo.push(patch);
    if (s.undo.length > LIMIT) s.undo.shift();
    s.redo = [];
  },
  undo(notebook: string, name: string, current: CanvasData): CanvasData | null {
    const s = get(keyOf(notebook, name));
    const patch = s.undo.pop();
    if (!patch) return null;
    s.redo.push(patch);
    return applyPatch(current, patch, true);
  },
  redo(notebook: string, name: string, current: CanvasData): CanvasData | null {
    const s = get(keyOf(notebook, name));
    const patch = s.redo.pop();
    if (!patch) return null;
    s.undo.push(patch);
    return applyPatch(current, patch, false);
  },
  canUndo: (notebook: string, name: string) => !!stacks.get(keyOf(notebook, name))?.undo.length,
  canRedo: (notebook: string, name: string) => !!stacks.get(keyOf(notebook, name))?.redo.length,
  rename(notebook: string, old: string, next: string) {
    const s = stacks.get(keyOf(notebook, old));
    if (!s) return;
    stacks.delete(keyOf(notebook, old));
    stacks.set(keyOf(notebook, next), s);
  },
  forget(notebook: string, name: string) {
    stacks.delete(keyOf(notebook, name));
  },
};
