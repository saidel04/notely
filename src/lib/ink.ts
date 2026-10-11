// Freehand pen strokes on canvases. A stroke is stored as a `drawing` node:
// its points relative to the node's box at the size it was drawn
// (`viewWidth` × `viewHeight`), so resizing the node scales the drawing.
// Pure helpers only (no DOM).

import type { DrawingNode } from "./canvas";
import { newId } from "./canvas";

export interface Pt {
  x: number;
  y: number;
}

/** Smallest box side a drawing node gets (the canvas format's minimum is 20). */
const MIN_SIDE = 20;

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker: drops points that lie within `eps` of the line. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let max = eps;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > max) (max = d), (far = i);
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A smooth SVG path through the points (quadratic curves via the midpoints). */
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return "";
  const f = (p: Pt) => `${r1(p.x)},${r1(p.y)}`;
  // A dot: a zero-length line still draws with round caps.
  if (pts.length === 1) return `M${f(pts[0])} L${f(pts[0])}`;
  if (pts.length === 2) return `M${f(pts[0])} L${f(pts[1])}`;
  let d = `M${f(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ` Q${f(pts[i])} ${f(mid)}`;
  }
  return d + ` L${f(pts[pts.length - 1])}`;
}

/**
 * Turns a finished stroke (world coordinates) into a drawing node whose box
 * hugs the stroke. `zoom` lets simplification adapt to how far in you drew.
 */
export function strokeNode(points: Pt[], strokeWidth: number, color?: string, zoom = 1): DrawingNode | null {
  if (!points.length) return null;
  const pts = simplify(points, 0.6 / zoom);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = strokeWidth / 2 + 2;
  let x0 = Math.min(...xs) - pad;
  let x1 = Math.max(...xs) + pad;
  let y0 = Math.min(...ys) - pad;
  let y1 = Math.max(...ys) + pad;
  // Thin strokes (a straight line) still get a box of at least the minimum size.
  if (x1 - x0 < MIN_SIDE) [x0, x1] = [(x0 + x1) / 2 - MIN_SIDE / 2, (x0 + x1) / 2 + MIN_SIDE / 2];
  if (y1 - y0 < MIN_SIDE) [y0, y1] = [(y0 + y1) / 2 - MIN_SIDE / 2, (y0 + y1) / 2 + MIN_SIDE / 2];
  const x = Math.floor(x0);
  const y = Math.floor(y0);
  const width = Math.ceil(x1 - x);
  const height = Math.ceil(y1 - y);
  return {
    id: newId(),
    type: "drawing",
    x,
    y,
    width,
    height,
    viewWidth: width,
    viewHeight: height,
    points: pts.flatMap((p) => [r1(p.x - x), r1(p.y - y)]),
    strokeWidth,
    ...(color ? { color } : {}),
  };
}

/** The drawing's points at its current size, in world coordinates. */
export function drawingPoints(n: DrawingNode): Pt[] {
  const sx = n.width / (n.viewWidth || n.width);
  const sy = n.height / (n.viewHeight || n.height);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < n.points.length; i += 2) out.push({ x: n.x + n.points[i] * sx, y: n.y + n.points[i + 1] * sy });
  return out;
}

/** SVG path of a drawing node, in world coordinates. */
export const drawingPath = (n: DrawingNode) => smoothPath(drawingPoints(n));
