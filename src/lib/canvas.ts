// Canvas documents use the open JSON Canvas format (https://jsoncanvas.org),
// with one optional extension: text nodes may carry a `shape`.
// Pure logic only (no DOM), so the agent server can share it.

export type Side = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";
export type Shape = "rectangle" | "rounded" | "ellipse" | "diamond";
export const SHAPES: Shape[] = ["rounded", "rectangle", "ellipse", "diamond"];

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** "1"–"6" (JSON Canvas presets) or "#rrggbb". */
  color?: string;
}

export interface TextNode extends NodeBase {
  type: "text";
  text: string;
  shape?: Shape;
}
export interface FileNode extends NodeBase {
  type: "file";
  /** Vault-relative path, e.g. "Biology/Cells.md" or "Biology/_pdfs/paper.pdf". */
  file: string;
  subpath?: string;
}
export interface LinkNode extends NodeBase {
  type: "link";
  url: string;
}
export interface GroupNode extends NodeBase {
  type: "group";
  label?: string;
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: Side;
  toEnd?: EdgeEnd;
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const EMPTY_CANVAS: CanvasData = { nodes: [], edges: [] };

/** JSON Canvas preset colors: 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple. */
export const PRESET_COLORS: Record<string, string> = {
  "1": "#e5484d",
  "2": "#f0883e",
  "3": "#e3b341",
  "4": "#3fb950",
  "5": "#39c5cf",
  "6": "#a371f7",
};

export function colorHex(color?: string): string | null {
  if (!color) return null;
  if (PRESET_COLORS[color]) return PRESET_COLORS[color];
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : null;
}

export const newId = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const num = (v: unknown): number | undefined => (typeof v === "number" && isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Default size for a node, grown to fit its text. */
export function sizeFor(text: string, shape?: Shape) {
  const lines = text.split("\n");
  const longest = Math.max(4, ...lines.map((l) => l.length));
  let width = Math.min(360, Math.max(140, longest * 8.2 + 40));
  const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 8.2) / (width - 40))), 0);
  let height = Math.max(60, wrapped * 22 + 36);
  if (shape === "diamond") {
    width *= 1.45;
    height *= 1.45;
  } else if (shape === "ellipse") {
    width *= 1.18;
    height *= 1.12;
  }
  return { width: Math.round(width / 10) * 10, height: Math.round(height / 10) * 10 };
}

/**
 * Parses canvas JSON leniently so hand- or agent-written files just work:
 * ids, sizes and types are filled in, `label`/`from`/`to` aliases accepted,
 * and nodes without coordinates are reported so they can be auto-laid-out.
 */
export function normalizeCanvas(raw: unknown): { data: CanvasData; unplaced: Set<string> } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  const unplaced = new Set<string>();
  const ids = new Set<string>();

  const nodes: CanvasNode[] = [];
  for (const r of rawNodes as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    let id = str(r.id) || newId();
    while (ids.has(id)) id = newId();
    ids.add(id);
    const type = (["text", "file", "link", "group"].includes(r.type as string) ? r.type : r.file ? "file" : r.url ? "link" : "text") as CanvasNode["type"];
    const shape = SHAPES.includes(r.shape as Shape) ? (r.shape as Shape) : undefined;
    const text = str(r.text) ?? str(r.label) ?? "";
    const fallback =
      type === "text" ? sizeFor(text, shape) : type === "group" ? { width: 400, height: 300 } : { width: 260, height: 140 };
    const base = {
      id,
      x: num(r.x) ?? 0,
      y: num(r.y) ?? 0,
      width: Math.max(20, num(r.width) ?? fallback.width),
      height: Math.max(20, num(r.height) ?? fallback.height),
      ...(colorHex(str(r.color)) ? { color: str(r.color) } : {}),
    };
    if (num(r.x) === undefined || num(r.y) === undefined) unplaced.add(id);
    if (type === "text") nodes.push({ ...base, type, text, ...(shape ? { shape } : {}) });
    else if (type === "file") nodes.push({ ...base, type, file: str(r.file) ?? "", ...(str(r.subpath) ? { subpath: str(r.subpath) } : {}) });
    else if (type === "link") nodes.push({ ...base, type, url: str(r.url) ?? "" });
    else nodes.push({ ...base, type, ...(str(r.label) ? { label: str(r.label) } : {}) });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set<string>();
  const edges: CanvasEdge[] = [];
  for (const r of rawEdges as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const fromNode = str(r.fromNode) ?? str(r.from);
    const toNode = str(r.toNode) ?? str(r.to);
    if (!fromNode || !toNode || !nodeIds.has(fromNode) || !nodeIds.has(toNode)) continue;
    let id = str(r.id) || newId();
    while (edgeIds.has(id)) id = newId();
    edgeIds.add(id);
    const e: CanvasEdge = { id, fromNode, toNode };
    if (SIDES.includes(r.fromSide as Side)) e.fromSide = r.fromSide as Side;
    if (SIDES.includes(r.toSide as Side)) e.toSide = r.toSide as Side;
    if (r.fromEnd === "arrow" || r.fromEnd === "none") e.fromEnd = r.fromEnd;
    if (r.toEnd === "arrow" || r.toEnd === "none") e.toEnd = r.toEnd;
    if (colorHex(str(r.color))) e.color = str(r.color);
    if (str(r.label)) e.label = str(r.label);
    edges.push(e);
  }
  return { data: { nodes, edges }, unplaced };
}

export function parseCanvas(text: string): { data: CanvasData; unplaced: Set<string> } {
  if (!text.trim()) return { data: { nodes: [], edges: [] }, unplaced: new Set() };
  return normalizeCanvas(JSON.parse(text));
}

/** Loads canvas text, auto-laying-out any nodes that came without coordinates. */
export function loadCanvas(text: string): { data: CanvasData; changed: boolean } {
  const { data, unplaced } = parseCanvas(text);
  if (!unplaced.size) return { data, changed: false };
  return { data: autoLayout(data, { only: unplaced }), changed: true };
}

export function serializeCanvas(data: CanvasData) {
  return JSON.stringify(data, null, "\t") + "\n";
}

// ---------- layout ----------

export type Direction = "TB" | "LR";

/**
 * Layered (Sugiyama-style) layout for flowcharts: ranks from the longest path,
 * barycenter ordering within ranks, then centered rows/columns.
 * `only` restricts which nodes move (others keep their positions and anchor the result).
 */
export function autoLayout(data: CanvasData, opts: { direction?: Direction; only?: Set<string> } = {}): CanvasData {
  const dir = opts.direction ?? "TB";
  if (opts.only && data.nodes.some((n) => !opts.only!.has(n.id))) {
    const attached = placeNearNeighbors(data, opts.only, dir);
    data = attached.data;
    if (!attached.rest.size) return data;
    opts = { ...opts, only: attached.rest };
  }
  const movable = data.nodes.filter((n) => n.type !== "group" && (!opts.only || opts.only.has(n.id)));
  if (!movable.length) return data;
  const ids = new Set(movable.map((n) => n.id));
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  movable.forEach((n) => (out.set(n.id, []), inn.set(n.id, [])));
  for (const e of data.edges) {
    if (!ids.has(e.fromNode) || !ids.has(e.toNode) || e.fromNode === e.toNode) continue;
    out.get(e.fromNode)!.push(e.toNode);
    inn.get(e.toNode)!.push(e.fromNode);
  }

  // Break cycles: ignore edges that point back to a node on the current DFS stack.
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id)!) {
      if (state.get(t) === 1) back.add(`${id}>${t}`);
      else if (!state.get(t)) dfs(t);
    }
    state.set(id, 2);
  };
  movable.forEach((n) => !state.get(n.id) && dfs(n.id));
  const fwd = (a: string, b: string) => !back.has(`${a}>${b}`);

  // Rank = longest path from a source.
  const rank = new Map<string, number>();
  const visit = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    rank.set(id, 0);
    const preds = inn.get(id)!.filter((p) => fwd(p, id));
    const r = preds.length ? Math.max(...preds.map(visit)) + 1 : 0;
    rank.set(id, r);
    return r;
  };
  movable.forEach((n) => visit(n.id));

  const layers: string[][] = [];
  movable.forEach((n) => (layers[rank.get(n.id)!] ??= []).push(n.id));
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < layers.length; i++) {
      const prevPos = new Map(layers[i - 1].map((id, j) => [id, j]));
      const bary = (id: string) => {
        const ps = inn.get(id)!.filter((p) => prevPos.has(p)).map((p) => prevPos.get(p)!);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
      };
      const cur = new Map(layers[i].map((id, j) => [id, j]));
      layers[i].sort((a, b) => (bary(a) === Infinity || bary(b) === Infinity ? cur.get(a)! - cur.get(b)! : bary(a) - bary(b)));
    }
  }

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const MAJOR_GAP = 90;
  const MINOR_GAP = 50;
  const major = (n: CanvasNode) => (dir === "TB" ? n.height : n.width);
  const minor = (n: CanvasNode) => (dir === "TB" ? n.width : n.height);

  // Keep the result near any nodes that stay put (or the origin).
  const fixed = data.nodes.filter((n) => n.type !== "group" && !ids.has(n.id));
  const originX = fixed.length ? Math.max(...fixed.map((n) => n.x + n.width)) + 120 : 0;
  const originY = fixed.length ? Math.min(...fixed.map((n) => n.y)) : 0;

  const pos = new Map<string, { x: number; y: number }>();
  const layerWidths = layers.map((l) => l.reduce((s, id) => s + minor(byId.get(id)!), 0) + MINOR_GAP * (l.length - 1));
  const widest = Math.max(...layerWidths);
  let along = 0;
  layers.forEach((layer, i) => {
    const thickness = Math.max(...layer.map((id) => major(byId.get(id)!)));
    let across = (widest - layerWidths[i]) / 2;
    for (const id of layer) {
      const n = byId.get(id)!;
      const offMajor = along + (thickness - major(n)) / 2;
      pos.set(id, dir === "TB" ? { x: across, y: offMajor } : { x: offMajor, y: across });
      across += minor(n) + MINOR_GAP;
    }
    along += thickness + MAJOR_GAP;
  });

  return {
    ...data,
    nodes: data.nodes.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, x: Math.round(originX + p.x), y: Math.round(originY + p.y) } : n;
    }),
  };
}

const overlaps = (a: CanvasNode, b: CanvasNode, gap = 24) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/**
 * Places new nodes that connect to already-placed ones next to their neighbor
 * (after a predecessor, or before a successor), sliding sideways to avoid overlaps.
 * Returns the nodes it couldn't attach.
 */
function placeNearNeighbors(data: CanvasData, fresh: Set<string>, dir: Direction): { data: CanvasData; rest: Set<string> } {
  const nodes = new Map(data.nodes.map((n) => [n.id, { ...n }]));
  const placed = new Set(data.nodes.filter((n) => !fresh.has(n.id) && n.type !== "group").map((n) => n.id));
  const rest = new Set(fresh);
  let progress = true;
  while (progress && rest.size) {
    progress = false;
    for (const id of [...rest]) {
      const n = nodes.get(id)!;
      if (n.type === "group") continue;
      const pred = data.edges.find((e) => e.toNode === id && placed.has(e.fromNode));
      const succ = pred ? undefined : data.edges.find((e) => e.fromNode === id && placed.has(e.toNode));
      const anchorNode = pred ? nodes.get(pred.fromNode)! : succ ? nodes.get(succ.toNode)! : null;
      if (!anchorNode) continue;
      const after = !!pred;
      if (dir === "TB") {
        n.x = Math.round(anchorNode.x + anchorNode.width / 2 - n.width / 2);
        n.y = after ? anchorNode.y + anchorNode.height + 90 : anchorNode.y - n.height - 90;
      } else {
        n.x = after ? anchorNode.x + anchorNode.width + 90 : anchorNode.x - n.width - 90;
        n.y = Math.round(anchorNode.y + anchorNode.height / 2 - n.height / 2);
      }
      // Slide alternately right/left (or down/up) until it doesn't overlap anything placed.
      const others = () => [...placed].map((p) => nodes.get(p)!);
      const base = { x: n.x, y: n.y };
      for (let i = 1; others().some((o) => overlaps(n, o)) && i < 60; i++) {
        const step = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
        if (dir === "TB") n.x = base.x + step * (n.width + 40);
        else n.y = base.y + step * (n.height + 30);
      }
      placed.add(id);
      rest.delete(id);
      progress = true;
    }
  }
  return { data: { ...data, nodes: data.nodes.map((n) => nodes.get(n.id)!) }, rest };
}

// ---------- geometry ----------

export interface Point {
  x: number;
  y: number;
}

export const center = (n: CanvasNode): Point => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

export function anchor(n: CanvasNode, side: Side): Point {
  switch (side) {
    case "top":
      return { x: n.x + n.width / 2, y: n.y };
    case "bottom":
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left":
      return { x: n.x, y: n.y + n.height / 2 };
    case "right":
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

/** Picks facing sides when an edge doesn't specify them. */
export function autoSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  // Prefer vertical connections unless the nodes are clearly side by side.
  if (Math.abs(dy) > Math.abs(dx) * 0.6 || Math.abs(dx) < (a.width + b.width) / 2) {
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  }
  return dx >= 0 ? ["right", "left"] : ["left", "right"];
}

const NORMALS: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface EdgeGeometry {
  path: string;
  start: Point;
  end: Point;
  mid: Point;
  /** Direction of travel at the end, for the arrowhead. */
  endAngle: number;
  startAngle: number;
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function edgeGeometry(from: CanvasNode, to: CanvasNode, e: Pick<CanvasEdge, "fromSide" | "toSide">): EdgeGeometry {
  const [autoFrom, autoTo] = autoSides(from, to);
  const fs = e.fromSide ?? autoFrom;
  const ts = e.toSide ?? autoTo;
  const start = anchor(from, fs);
  const end = anchor(to, ts);
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const k = Math.min(Math.max(dist * 0.45, 30), 140);
  const c1 = { x: start.x + NORMALS[fs].x * k, y: start.y + NORMALS[fs].y * k };
  const c2 = { x: end.x + NORMALS[ts].x * k, y: end.y + NORMALS[ts].y * k };
  return {
    path: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
    start,
    end,
    mid: cubicPoint(start, c1, c2, end, 0.5),
    endAngle: Math.atan2(end.y - c2.y, end.x - c2.x),
    startAngle: Math.atan2(start.y - c1.y, start.x - c1.x),
  };
}

export function bounds(nodes: CanvasNode[]) {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.width));
  const y1 = Math.max(...nodes.map((n) => n.y + n.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Plain text of a canvas, for search. */
export function canvasText(data: CanvasData) {
  return [
    ...data.nodes.map((n) => (n.type === "text" ? n.text : n.type === "group" ? (n.label ?? "") : n.type === "link" ? n.url : "")),
    ...data.edges.map((e) => e.label ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * What a file node points to. Paths are vault-relative ("Notebook/Note.md",
 * "Notebook/_pdfs/x.pdf"); a bare "Note.md" means the canvas's own notebook.
 */
export function fileNodeTarget(file: string, notebook: string): { kind: "note" | "pdf" | "canvas"; name: string; notebook: string } | null {
  const parts = file.replace(/\\/g, "/").split("/").filter(Boolean);
  let nb = notebook;
  const isRest = (p: string[]) =>
    (p.length === 1 && /\.(md|canvas|pdf)$/i.test(p[0])) || (p.length === 2 && p[0] === "_pdfs" && /\.pdf$/i.test(p[1]));
  if (!isRest(parts) && parts.length > 1) nb = parts.shift()!;
  if (!isRest(parts)) return null;
  const last = parts[parts.length - 1];
  if (/\.md$/i.test(last)) return { kind: "note", name: last.slice(0, -3), notebook: nb };
  if (/\.canvas$/i.test(last)) return { kind: "canvas", name: last.slice(0, -7), notebook: nb };
  return { kind: "pdf", name: last, notebook: nb };
}

export function fileNodePath(notebook: string, kind: "note" | "pdf" | "canvas", name: string) {
  return kind === "note" ? `${notebook}/${name}.md` : kind === "canvas" ? `${notebook}/${name}.canvas` : `${notebook}/_pdfs/${name}`;
}
