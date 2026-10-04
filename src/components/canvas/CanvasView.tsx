import {
  ArrowRight,
  BookOpen,
  Circle,
  Diamond,
  FileText,
  Group as GroupIcon,
  Hand,
  LayoutGrid,
  Maximize2,
  Minus,
  MousePointer2,
  Network,
  Plus,
  Redo2,
  RectangleHorizontal,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  autoLayout,
  bounds,
  CanvasData,
  CanvasEdge,
  CanvasNode,
  center,
  Direction,
  EMPTY_CANVAS,
  fileNodePath,
  fileNodeTarget,
  newId,
  PRESET_COLORS,
  Shape,
  Side,
  sizeFor,
} from "../../lib/canvas";
import { DraggedQuote, ITEM_MIME, QUOTE_MIME } from "../../lib/dragQuote";
import { formatLink, parseLinks, qualify } from "../../lib/links";
import { followLink } from "../../lib/navigate";
import { settings, setSettingSoon } from "../../lib/settings";
import { useCanvases } from "../../store/canvasStore";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { PaneIndex } from "../../store/workspaceStore";
import { Floating } from "../ui/Menu";
import { CanvasScene } from "./CanvasScene";

type Tool = "select" | "hand" | Shape | "group";
interface View {
  x: number;
  y: number;
  k: number;
}
interface Pt {
  x: number;
  y: number;
}
type Corner = "nw" | "ne" | "sw" | "se";

type Drag =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "move"; start: Pt; orig: Map<string, Pt>; snapshot: CanvasData; moved: boolean }
  | { kind: "resize"; id: string; corner: Corner; orig: CanvasNode; snapshot: CanvasData }
  | { kind: "connect"; from: string; side: Side; snapshot: CanvasData }
  | { kind: "marquee"; start: Pt; additive: boolean }
  | { kind: "create"; tool: Shape | "group"; start: Pt };

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const MIN_K = 0.15;
const MAX_K = 3;

const TOOL_SIZE: Record<Shape | "group", { width: number; height: number }> = {
  rounded: { width: 180, height: 70 },
  rectangle: { width: 180, height: 70 },
  ellipse: { width: 170, height: 90 },
  diamond: { width: 190, height: 110 },
  group: { width: 420, height: 300 },
};

function sideNearest(n: CanvasNode, p: Pt): Side {
  const d: Record<Side, number> = {
    top: Math.abs(p.y - n.y),
    bottom: Math.abs(p.y - (n.y + n.height)),
    left: Math.abs(p.x - n.x),
    right: Math.abs(p.x - (n.x + n.width)),
  };
  return SIDES.reduce((a, b) => (d[a] <= d[b] ? a : b));
}

const inside = (n: CanvasNode, g: CanvasNode) =>
  n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height;

export function CanvasView({ notebook, name, pane }: { notebook: string; name: string; pane: PaneIndex }) {
  const data = useCanvases((s) => s.data[name]) ?? EMPTY_CANVAS;
  const broken = useCanvases((s) => s.broken[name]);
  const loaded = useCanvases((s) => name in s.data);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [sel, setSel] = useState<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });
  const [tool, setTool] = useState<Tool>("select");
  const [editing, setEditing] = useState<string | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: CanvasNode; fromSide: Side; to: Pt } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null);
  // Mirrors drag.current for rendering (refs don't re-render).
  const [dragKind, setDragKind] = useState<Drag["kind"] | null>(null);
  const undo = useRef<CanvasData[]>([]);
  const redo = useRef<CanvasData[]>([]);
  const editSnapshot = useRef<CanvasData | null>(null);
  const viewKey = `cview:${notebook}/${name}`;

  const dataRef = useRef(data);
  dataRef.current = data;
  const store = useCanvases.getState();

  // ---------- data changes ----------
  const live = useCallback((next: CanvasData) => store.set(name, next), [name, store]);
  const commit = useCallback(
    (next: CanvasData, snapshot: CanvasData = dataRef.current) => {
      undo.current.push(snapshot);
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
      store.set(name, next);
    },
    [name, store],
  );
  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(dataRef.current);
    store.set(name, prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(dataRef.current);
    store.set(name, next);
  };
  const patchNode = (id: string, patch: Partial<CanvasNode>, d = dataRef.current): CanvasData => ({
    ...d,
    nodes: d.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as CanvasNode) : n)),
  });

  // ---------- viewport ----------
  const toWorld = useCallback(
    (cx: number, cy: number): Pt => {
      const r = host.current!.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
    },
    [view],
  );

  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const b = bounds(dataRef.current.nodes);
    const { width, height } = el.getBoundingClientRect();
    if (!b.width) return setView({ x: width / 2, y: height / 2, k: 1 });
    const k = Math.min(1.2, Math.max(MIN_K, Math.min((width - 120) / b.width, (height - 140) / b.height)));
    setView({ x: width / 2 - (b.x + b.width / 2) * k, y: height / 2 - (b.y + b.height / 2) * k + 10, k });
  }, []);

  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!loaded || restored.current) return;
    restored.current = true;
    void settings.get<View>(viewKey).then((v) => (v ? setView(v) : fit()));
  }, [loaded, viewKey, fit]);
  useEffect(() => {
    if (restored.current) setSettingSoon(viewKey, view, 800);
  }, [view, viewKey]);

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const r = host.current!.getBoundingClientRect();
    setView((v) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
      const px = cx - r.left;
      const py = cy - r.top;
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".cv-editor, .cv-toolbar, .cv-floating")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // ---------- creation helpers ----------
  const addNode = (node: CanvasNode, opts: { edit?: boolean; connectFrom?: { id: string; side: Side }; snapshot?: CanvasData } = {}) => {
    const d = dataRef.current;
    const edges = [...d.edges];
    if (opts.connectFrom) {
      const from = d.nodes.find((n) => n.id === opts.connectFrom!.id)!;
      edges.push({ id: newId(), fromNode: from.id, fromSide: opts.connectFrom.side, toNode: node.id, toSide: sideNearest(node, center(from)), toEnd: "arrow" });
    }
    commit({ nodes: [...d.nodes, node], edges }, opts.snapshot ?? d);
    setSel({ nodes: new Set([node.id]), edges: new Set() });
    if (opts.edit) {
      editSnapshot.current = null;
      setEditing(node.id);
    }
  };

  const newShape = (shape: Shape | "group", at: Pt, size?: { width: number; height: number }): CanvasNode => {
    const s = size ?? TOOL_SIZE[shape];
    const base = { id: newId(), x: snap(at.x - s.width / 2), y: snap(at.y - s.height / 2), width: snap(s.width), height: snap(s.height) };
    return shape === "group" ? { ...base, type: "group", label: "Group" } : { ...base, type: "text", text: "", shape };
  };

  const addCard = (kind: "note" | "pdf" | "canvas", item: string, at?: Pt) => {
    const el = host.current!.getBoundingClientRect();
    const p = at ?? toWorld(el.left + el.width / 2, el.top + el.height / 2);
    const size = kind === "note" ? { width: 300, height: 200 } : { width: 260, height: 90 };
    addNode({ id: newId(), type: "file", file: fileNodePath(notebook, kind, item), x: snap(p.x - size.width / 2), y: snap(p.y - size.height / 2), ...size });
  };

  const deleteSelection = () => {
    const d = dataRef.current;
    if (!sel.nodes.size && !sel.edges.size) return;
    commit({
      nodes: d.nodes.filter((n) => !sel.nodes.has(n.id)),
      edges: d.edges.filter((e) => !sel.edges.has(e.id) && !sel.nodes.has(e.fromNode) && !sel.nodes.has(e.toNode)),
    });
    setSel({ nodes: new Set(), edges: new Set() });
  };

  const duplicateSelection = () => {
    const d = dataRef.current;
    const map = new Map<string, string>();
    const copies = d.nodes.filter((n) => sel.nodes.has(n.id)).map((n) => {
      const id = newId();
      map.set(n.id, id);
      return { ...n, id, x: n.x + 30, y: n.y + 30 };
    });
    if (!copies.length) return;
    const edgeCopies = d.edges
      .filter((e) => map.has(e.fromNode) && map.has(e.toNode))
      .map((e) => ({ ...e, id: newId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }));
    commit({ nodes: [...d.nodes, ...copies], edges: [...d.edges, ...edgeCopies] });
    setSel({ nodes: new Set(copies.map((c) => c.id)), edges: new Set() });
  };

  const tidy = (direction: Direction) => {
    commit(autoLayout(dataRef.current, { direction }));
    requestAnimationFrame(fit);
  };

  const openFileNode = (n: CanvasNode) => {
    if (n.type !== "file") return;
    const t = fileNodeTarget(n.file, notebook);
    if (!t) return;
    const name = t.kind === "canvas" ? `${t.name}.canvas` : t.name;
    // Same path as clicking a link, so cards into other notebooks work too.
    const link = parseLinks(formatLink(qualify(name, t.notebook, notebook)))[0];
    void followLink(link, pane, false);
  };

  // ---------- pointer interaction ----------
  const nodeAt = (clientX: number, clientY: number, exclude?: string): CanvasNode | null => {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const id = (el as Element).closest?.("[data-node]")?.getAttribute("data-node");
      if (id && id !== exclude) {
        const n = dataRef.current.nodes.find((x) => x.id === id);
        if (n && n.type !== "group") return n;
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".cv-editor, .cv-toolbar, .cv-floating")) return;
    host.current?.focus();
    const t = e.target as Element;
    const p = toWorld(e.clientX, e.clientY);
    const d = dataRef.current;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (e.button === 1 || space || tool === "hand") {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, view };
      return;
    }
    if (e.button !== 0) return;

    // Ctrl+click a #tag inside a box to filter the sidebar by it.
    const tagEl = t.closest("[data-tag]");
    if (tagEl && (e.ctrlKey || e.metaKey)) {
      useUi.setState({ tagFilter: tagEl.getAttribute("data-tag"), sidebarOpen: true });
      return;
    }

    // Ctrl+click a [[link]] inside a box to follow it.
    const wiki = t.closest("[data-link]");
    if (wiki && (e.ctrlKey || e.metaKey)) {
      const link = parseLinks(decodeURIComponent(wiki.getAttribute("data-link")!))[0];
      if (link) void followLink(link, pane, false);
      return;
    }

    const port = t.closest("[data-port]");
    if (port) {
      const [id, side] = port.getAttribute("data-port")!.split(":");
      drag.current = { kind: "connect", from: id, side: side as Side, snapshot: d };
      return;
    }
    const handle = t.closest("[data-resize]");
    if (handle) {
      const [id, corner] = handle.getAttribute("data-resize")!.split(":");
      const orig = d.nodes.find((n) => n.id === id)!;
      drag.current = { kind: "resize", id, corner: corner as Corner, orig, snapshot: d };
      return;
    }
    if (tool !== "select") {
      drag.current = { kind: "create", tool, start: p };
      setMarquee({ a: p, b: p });
      return;
    }

    const nodeId = t.closest("[data-node]")?.getAttribute("data-node");
    const edgeId = t.closest("[data-edge]")?.getAttribute("data-edge");
    if (nodeId) {
      let nodes = sel.nodes;
      if (e.shiftKey) {
        nodes = new Set(sel.nodes);
        if (nodes.has(nodeId)) nodes.delete(nodeId);
        else nodes.add(nodeId);
      } else if (!sel.nodes.has(nodeId)) nodes = new Set([nodeId]);
      setSel({ nodes, edges: e.shiftKey ? sel.edges : new Set() });
      // Groups carry the nodes inside them.
      const moving = new Set(nodes);
      for (const id of nodes) {
        const g = d.nodes.find((n) => n.id === id);
        if (g?.type === "group") d.nodes.filter((n) => inside(n, g)).forEach((n) => moving.add(n.id));
      }
      const orig = new Map(d.nodes.filter((n) => moving.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
      drag.current = { kind: "move", start: p, orig, snapshot: d, moved: false };
      return;
    }
    if (edgeId) {
      setSel({ nodes: e.shiftKey ? sel.nodes : new Set(), edges: new Set([edgeId]) });
      return;
    }
    drag.current = { kind: "marquee", start: p, additive: e.shiftKey };
    if (!e.shiftKey) setSel({ nodes: new Set(), edges: new Set() });
    setMarquee({ a: p, b: p });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (dr && dragKind !== dr.kind) setDragKind(dr.kind);
    if (!dr) {
      const id = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
      if (id !== hover) setHover(id);
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    const d = dataRef.current;
    switch (dr.kind) {
      case "pan":
        setView({ ...dr.view, x: dr.view.x + e.clientX - dr.sx, y: dr.view.y + e.clientY - dr.sy });
        break;
      case "move": {
        const dx = p.x - dr.start.x;
        const dy = p.y - dr.start.y;
        if (!dr.moved && Math.hypot(dx, dy) * view.k < 3) return;
        dr.moved = true;
        live({ ...d, nodes: d.nodes.map((n) => (dr.orig.has(n.id) ? { ...n, x: snap(dr.orig.get(n.id)!.x + dx), y: snap(dr.orig.get(n.id)!.y + dy) } : n)) });
        break;
      }
      case "resize": {
        const o = dr.orig;
        let { x, y, width, height } = o;
        if (dr.corner.includes("e")) width = Math.max(40, snap(p.x - o.x));
        if (dr.corner.includes("s")) height = Math.max(30, snap(p.y - o.y));
        if (dr.corner.includes("w")) {
          x = Math.min(o.x + o.width - 40, snap(p.x));
          width = o.x + o.width - x;
        }
        if (dr.corner.includes("n")) {
          y = Math.min(o.y + o.height - 30, snap(p.y));
          height = o.y + o.height - y;
        }
        live(patchNode(dr.id, { x, y, width, height }));
        break;
      }
      case "connect": {
        const from = d.nodes.find((n) => n.id === dr.from)!;
        setPending({ from, fromSide: dr.side, to: p });
        setHover(nodeAt(e.clientX, e.clientY, dr.from)?.id ?? null);
        break;
      }
      case "marquee":
      case "create":
        setMarquee((m) => (m ? { ...m, b: p } : m));
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const dr = drag.current;
    drag.current = null;
    setDragKind(null);
    if (!dr) return;
    const p = toWorld(e.clientX, e.clientY);
    const d = dataRef.current;
    switch (dr.kind) {
      case "move":
        if (dr.moved) commit(d, dr.snapshot);
        break;
      case "resize":
        commit(d, dr.snapshot);
        break;
      case "connect": {
        setPending(null);
        const from = d.nodes.find((n) => n.id === dr.from)!;
        const target = nodeAt(e.clientX, e.clientY, dr.from);
        if (target) {
          const edge: CanvasEdge = { id: newId(), fromNode: from.id, fromSide: dr.side, toNode: target.id, toSide: sideNearest(target, p), toEnd: "arrow" };
          commit({ ...d, edges: [...d.edges, edge] }, dr.snapshot);
          setSel({ nodes: new Set(), edges: new Set([edge.id]) });
        } else if (Math.hypot(p.x - center(from).x, p.y - center(from).y) > 40) {
          // Released on empty space: grow the flowchart with a new connected node.
          const shape = from.type === "text" ? (from.shape ?? "rounded") : "rounded";
          const size = { width: Math.max(140, from.width), height: from.type === "text" ? from.height : 70 };
          addNode(newShape(shape, p, size), { edit: true, connectFrom: { id: from.id, side: dr.side }, snapshot: dr.snapshot });
        }
        break;
      }
      case "marquee": {
        const m = marquee;
        setMarquee(null);
        if (!m) break;
        const [x0, x1] = [Math.min(m.a.x, m.b.x), Math.max(m.a.x, m.b.x)];
        const [y0, y1] = [Math.min(m.a.y, m.b.y), Math.max(m.a.y, m.b.y)];
        if (x1 - x0 < 3 && y1 - y0 < 3) break;
        const hit = d.nodes.filter((n) => n.x < x1 && n.x + n.width > x0 && n.y < y1 && n.y + n.height > y0).map((n) => n.id);
        setSel((s) => ({ nodes: new Set([...(dr.additive ? s.nodes : []), ...hit]), edges: new Set() }));
        break;
      }
      case "create": {
        const m = marquee;
        setMarquee(null);
        const w = m ? Math.abs(m.b.x - m.a.x) : 0;
        const h = m ? Math.abs(m.b.y - m.a.y) : 0;
        const dragged = w > 20 && h > 20;
        const at = dragged && m ? { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 } : dr.start;
        const node = newShape(dr.tool, at, dragged ? { width: w, height: h } : undefined);
        addNode(node, { edit: node.type === "text" });
        if (!e.shiftKey) setTool("select");
        break;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".cv-editor, .cv-toolbar, .cv-floating")) return;
    const t = e.target as Element;
    const nodeId = t.closest("[data-node]")?.getAttribute("data-node");
    const edgeId = t.closest("[data-edge]")?.getAttribute("data-edge");
    if (nodeId) {
      const n = dataRef.current.nodes.find((x) => x.id === nodeId)!;
      if (n.type === "file") return openFileNode(n);
      if (n.type === "text" || n.type === "group") {
        editSnapshot.current = dataRef.current;
        setEditing(nodeId);
      }
      return;
    }
    if (edgeId) {
      editSnapshot.current = dataRef.current;
      setEditingEdge(edgeId);
      return;
    }
    addNode(newShape("rounded", toWorld(e.clientX, e.clientY)), { edit: true });
  };

  // ---------- keyboard ----------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("textarea, input")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z" && !e.shiftKey) doUndo();
    else if ((mod && k === "y") || (mod && e.shiftKey && k === "z")) doRedo();
    else if (mod && k === "a") setSel({ nodes: new Set(dataRef.current.nodes.map((n) => n.id)), edges: new Set() });
    else if (mod && k === "d") duplicateSelection();
    else if (k === "delete" || k === "backspace") deleteSelection();
    else if (k === "escape") (setSel({ nodes: new Set(), edges: new Set() }), setTool("select"));
    else if (k === "enter" && sel.nodes.size === 1) {
      const id = [...sel.nodes][0];
      const n = dataRef.current.nodes.find((x) => x.id === id);
      if (n?.type === "file") openFileNode(n);
      else {
        editSnapshot.current = dataRef.current;
        setEditing(id);
      }
    } else if (k.startsWith("arrow") && sel.nodes.size) {
      const step = e.shiftKey ? GRID * 5 : GRID;
      const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
      const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
      const d = dataRef.current;
      commit({ ...d, nodes: d.nodes.map((n) => (sel.nodes.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) });
    } else if (!mod && k === "v") setTool("select");
    else if (!mod && k === "h") setTool("hand");
    else if (!mod && k === "r") setTool("rounded");
    else if (!mod && k === "o") setTool("ellipse");
    else if (!mod && k === "d") setTool("diamond");
    else if (!mod && k === "g") setTool("group");
    else if (!mod && k === "0" && e.shiftKey) fit();
    else if (k === " ") setSpace(true);
    else return;
    e.preventDefault();
  };

  // ---------- text editing ----------
  const editingNode = editing ? data.nodes.find((n) => n.id === editing) : null;
  const finishEditing = () => {
    if (!editing) return;
    const n = dataRef.current.nodes.find((x) => x.id === editing);
    const snapshot = editSnapshot.current;
    editSnapshot.current = null;
    setEditing(null);
    if (!n) return;
    if (n.type === "text" && !n.text.trim() && snapshot === null) {
      // A new node left empty: discard it (and the edge that created it).
      const d = dataRef.current;
      store.set(name, { nodes: d.nodes.filter((x) => x.id !== n.id), edges: d.edges.filter((x) => x.fromNode !== n.id && x.toNode !== n.id) });
      undo.current.pop();
      return;
    }
    if (snapshot) commit(dataRef.current, snapshot);
  };

  const editingEdgeData = editingEdge ? data.edges.find((x) => x.id === editingEdge) : null;

  // Drop notes/PDFs from the sidebar onto the canvas.
  const onDrop = (e: React.DragEvent) => {
    const quote = e.dataTransfer.getData(QUOTE_MIME);
    if (quote) {
      e.preventDefault();
      const q = JSON.parse(quote) as DraggedQuote;
      const text = `“${q.text}”\n\n— ${formatLink(q.pdf, q.id, `p. ${q.page}`)}`;
      const size = { width: 320, height: Math.min(320, sizeFor(q.text, "rectangle").height + 40) };
      const p = toWorld(e.clientX, e.clientY);
      addNode({ id: newId(), type: "text", text, color: "3", x: snap(p.x - size.width / 2), y: snap(p.y - size.height / 2), ...size });
      return;
    }
    const raw = e.dataTransfer.getData(ITEM_MIME);
    if (!raw) return;
    e.preventDefault();
    const item = JSON.parse(raw) as { kind: "note" | "pdf" | "canvas"; name: string };
    if (item.kind === "canvas" && item.name === name) return;
    addCard(item.kind, item.name, toWorld(e.clientX, e.clientY));
  };

  const selectedNode = sel.nodes.size === 1 ? data.nodes.find((n) => sel.nodes.has(n.id)) : null;
  const selectedEdge = sel.edges.size === 1 && !sel.nodes.size ? data.edges.find((x) => sel.edges.has(x.id)) : null;
  const selectionBox = useMemo(() => {
    const nodes = data.nodes.filter((n) => sel.nodes.has(n.id));
    return nodes.length ? bounds(nodes) : null;
  }, [data.nodes, sel.nodes]);

  if (broken) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-[13px] text-muted">
        <div className="font-medium text-ink">This canvas file couldn't be read</div>
        <div className="max-w-md text-faint">{broken}</div>
        <div className="text-faint">Fix the JSON in a text editor; Notely won't overwrite it.</div>
      </div>
    );
  }

  const cursor = space || tool === "hand" ? (dragKind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  const toScreen = (p: Pt) => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y });

  return (
    <div
      ref={host}
      tabIndex={0}
      className="cv relative h-full overflow-hidden outline-none select-none"
      style={{
        cursor,
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key === " " && setSpace(false)}
      onDragOver={(e) => (e.dataTransfer.types.includes(ITEM_MIME) || e.dataTransfer.types.includes(QUOTE_MIME)) && e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="absolute inset-0 h-full w-full">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <CanvasScene
            data={data}
            notebook={notebook}
            selectedNodes={sel.nodes}
            selectedEdges={sel.edges}
            editingId={editing}
            pendingEdge={pending}
            hoverId={hover}
            interactive
          />

          {/* Resize handles + connection ports */}
          {selectedNode && !editing && <Handles node={selectedNode} k={view.k} />}
          {data.nodes
            .filter((n) => n.type !== "group" && (n.id === hover || sel.nodes.has(n.id)) && tool === "select" && !editing)
            .map((n) => (
              <Ports key={n.id} node={n} k={view.k} />
            ))}

          {marquee && (
            <rect
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.b.x - marquee.a.x)}
              height={Math.abs(marquee.b.y - marquee.a.y)}
              className="cv-marquee"
              strokeWidth={1 / view.k}
              rx={dragKind === "create" ? 8 : 0}
            />
          )}

          {editingNode && (
            <foreignObject x={editingNode.x} y={editingNode.y - (editingNode.type === "group" ? 30 : 0)} width={editingNode.width} height={editingNode.type === "group" ? 28 : editingNode.height}>
              <textarea
                autoFocus
                className={`cv-editor ${editingNode.type === "group" ? "cv-editor-group" : ""}`}
                value={editingNode.type === "text" ? editingNode.text : editingNode.type === "group" ? (editingNode.label ?? "") : ""}
                placeholder={editingNode.type === "group" ? "Group name" : "Type…"}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (editingNode.type === "group") return live(patchNode(editingNode.id, { label: v }));
                  // Grow the node to fit its text while typing.
                  const auto = sizeFor(v, editingNode.type === "text" ? editingNode.shape : undefined);
                  live(patchNode(editingNode.id, { text: v, height: Math.max(editingNode.height, Math.min(auto.height, 600)) } as Partial<CanvasNode>));
                }}
                onBlur={finishEditing}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || editingNode.type === "group"))) {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                  }
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </foreignObject>
          )}
        </g>
      </svg>

      {/* Edge label editor */}
      {editingEdgeData && (
        <EdgeLabelInput
          edge={editingEdgeData}
          data={data}
          toScreen={toScreen}
          onChange={(label) => live({ ...dataRef.current, edges: dataRef.current.edges.map((x) => (x.id === editingEdgeData.id ? { ...x, label: label || undefined } : x)) })}
          onDone={() => {
            if (editSnapshot.current) commit(dataRef.current, editSnapshot.current);
            editSnapshot.current = null;
            setEditingEdge(null);
          }}
        />
      )}

      {/* Main toolbar */}
      <div className="cv-toolbar absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface/95 p-1 shadow-pop backdrop-blur">
        <ToolBtn active={tool === "select"} title="Select (V)" onClick={() => setTool("select")}><MousePointer2 size={15} /></ToolBtn>
        <ToolBtn active={tool === "hand"} title="Pan (H, or hold Space)" onClick={() => setTool("hand")}><Hand size={15} /></ToolBtn>
        <Divider />
        <ToolBtn active={tool === "rounded"} title="Box (R) — click or drag to place" onClick={() => setTool("rounded")}><RectangleHorizontal size={15} /></ToolBtn>
        <ToolBtn active={tool === "rectangle"} title="Square-cornered box" onClick={() => setTool("rectangle")}><Square size={15} /></ToolBtn>
        <ToolBtn active={tool === "ellipse"} title="Ellipse (O)" onClick={() => setTool("ellipse")}><Circle size={15} /></ToolBtn>
        <ToolBtn active={tool === "diamond"} title="Decision diamond (D)" onClick={() => setTool("diamond")}><Diamond size={15} /></ToolBtn>
        <ToolBtn active={tool === "group"} title="Group (G)" onClick={() => setTool("group")}><GroupIcon size={15} /></ToolBtn>
        <ToolBtn title="Add a note or PDF card" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCardMenu({ x: r.left, y: r.bottom + 6 }); }}><FileText size={15} /></ToolBtn>
        <Divider />
        <ToolBtn title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!undo.current.length}><Undo2 size={15} /></ToolBtn>
        <ToolBtn title="Redo (Ctrl+Shift+Z)" onClick={doRedo} disabled={!redo.current.length}><Redo2 size={15} /></ToolBtn>
        <Divider />
        <ToolBtn title="Tidy layout — top to bottom" onClick={() => tidy("TB")}><Network size={15} /></ToolBtn>
        <ToolBtn title="Tidy layout — left to right" onClick={() => tidy("LR")}><LayoutGrid size={15} className="-rotate-90" /></ToolBtn>
      </div>

      {/* Selection toolbar */}
      {(selectionBox || selectedEdge) && !editing && (!dragKind || dragKind === "marquee") && (
        <SelectionBar
          pos={selectionBox ? toScreen({ x: selectionBox.x + selectionBox.width / 2, y: selectionBox.y }) : (() => {
            const a = data.nodes.find((n) => n.id === selectedEdge!.fromNode)!;
            const b = data.nodes.find((n) => n.id === selectedEdge!.toNode)!;
            return toScreen({ x: (center(a).x + center(b).x) / 2, y: (center(a).y + center(b).y) / 2 - 20 });
          })()}
          color={selectedNode?.color ?? selectedEdge?.color}
          shape={selectedNode?.type === "text" ? (selectedNode.shape ?? "rounded") : undefined}
          edge={selectedEdge ?? undefined}
          onColor={(c) => {
            const d = dataRef.current;
            commit({
              nodes: d.nodes.map((n) => (sel.nodes.has(n.id) ? { ...n, color: c } : n)),
              edges: d.edges.map((x) => (sel.edges.has(x.id) ? { ...x, color: c } : x)),
            });
          }}
          onShape={(s) => {
            const d = dataRef.current;
            commit({
              ...d,
              nodes: d.nodes.map((n) => {
                if (!sel.nodes.has(n.id) || n.type !== "text") return n;
                // Diamonds and ellipses need more room for the same text.
                const fit = sizeFor(n.text, s);
                return { ...n, shape: s, width: Math.max(n.width, fit.width), height: Math.max(n.height, fit.height) };
              }),
            });
          }}
          onArrows={(fromEnd, toEnd) => {
            const d = dataRef.current;
            commit({ ...d, edges: d.edges.map((x) => (sel.edges.has(x.id) ? { ...x, fromEnd, toEnd } : x)) });
          }}
          onLabel={() => {
            editSnapshot.current = dataRef.current;
            setEditingEdge(selectedEdge!.id);
          }}
          onDelete={deleteSelection}
        />
      )}

      {/* Zoom controls */}
      <div className="cv-toolbar absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-full border border-line bg-surface/95 p-1 text-[12px] text-muted shadow-pop">
        <ToolBtn round title="Zoom out" onClick={() => { const r = host.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); }}><Minus size={14} /></ToolBtn>
        <span className="w-10 text-center tabular-nums">{Math.round(view.k * 100)}%</span>
        <ToolBtn round title="Zoom in" onClick={() => { const r = host.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); }}><Plus size={14} /></ToolBtn>
        <ToolBtn round title="Fit to content (Shift+0)" onClick={fit}><Maximize2 size={13} /></ToolBtn>
      </div>

      {data.nodes.length === 0 && loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[14px] font-medium text-ink">Empty canvas</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-faint">
              Double-click to add a box · drag a box's edge dot to connect or grow a flowchart
              <br />
              Drag notes and PDFs here from the sidebar
            </div>
          </div>
        </div>
      )}

      {cardMenu && <CardMenu pos={cardMenu} notebook={notebook} self={name} onClose={() => setCardMenu(null)} onPick={(k, n) => (setCardMenu(null), addCard(k, n))} />}
    </div>
  );
}

// ---------- pieces ----------

function Handles({ node, k }: { node: CanvasNode; k: number }) {
  const s = 9 / k;
  const corners: [Corner, number, number][] = [
    ["nw", node.x, node.y],
    ["ne", node.x + node.width, node.y],
    ["sw", node.x, node.y + node.height],
    ["se", node.x + node.width, node.y + node.height],
  ];
  return (
    <g>
      {corners.map(([c, x, y]) => (
        <rect key={c} data-resize={`${node.id}:${c}`} x={x - s / 2} y={y - s / 2} width={s} height={s} rx={2 / k} className={`cv-handle cv-${c}`} strokeWidth={1.5 / k} />
      ))}
    </g>
  );
}

function Ports({ node, k }: { node: CanvasNode; k: number }) {
  const off = 16 / k;
  const pts: [Side, number, number][] = [
    ["top", node.x + node.width / 2, node.y - off],
    ["right", node.x + node.width + off, node.y + node.height / 2],
    ["bottom", node.x + node.width / 2, node.y + node.height + off],
    ["left", node.x - off, node.y + node.height / 2],
  ];
  return (
    <g data-node={node.id}>
      {pts.map(([side, x, y]) => (
        <g key={side} data-port={`${node.id}:${side}`} className="cv-port">
          <circle cx={x} cy={y} r={10 / k} fill="transparent" />
          <circle cx={x} cy={y} r={4.5 / k} strokeWidth={1.5 / k} />
        </g>
      ))}
    </g>
  );
}

function ToolBtn({
  children,
  title,
  onClick,
  active,
  disabled,
  round,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  round?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-8 items-center justify-center ${round ? "size-7 rounded-full" : "rounded-lg"} transition-colors disabled:opacity-35 ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-line" />;

const SWATCHES = [undefined, ...Object.keys(PRESET_COLORS)];

function SelectionBar({
  pos,
  color,
  shape,
  edge,
  onColor,
  onShape,
  onArrows,
  onLabel,
  onDelete,
}: {
  pos: Pt;
  color?: string;
  shape?: Shape;
  edge?: CanvasEdge;
  onColor: (c: string | undefined) => void;
  onShape: (s: Shape) => void;
  onArrows: (fromEnd: "none" | "arrow", toEnd: "none" | "arrow") => void;
  onLabel: () => void;
  onDelete: () => void;
}) {
  const shapes: [Shape, React.ReactNode][] = [
    ["rounded", <RectangleHorizontal size={14} />],
    ["rectangle", <Square size={14} />],
    ["ellipse", <Circle size={14} />],
    ["diamond", <Diamond size={14} />],
  ];
  const arrows = edge ? `${edge.fromEnd ?? "none"}-${edge.toEnd ?? "arrow"}` : "";
  return (
    <div
      className="cv-floating animate-pop absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-pop"
      style={{ left: pos.x, top: pos.y - 14 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SWATCHES.map((c) => (
        <button
          key={c ?? "none"}
          title={c ? "Color" : "No color"}
          onClick={() => onColor(c)}
          className={`size-[18px] rounded-full border ${color === c ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""} ${c ? "border-black/10" : "border-line-strong bg-surface"}`}
          style={c ? { background: PRESET_COLORS[c] } : undefined}
        />
      ))}
      {shape && (
        <>
          <Divider />
          {shapes.map(([s, icon]) => (
            <button key={s} title={s} onClick={() => onShape(s)} className={`flex size-7 items-center justify-center rounded-md ${shape === s ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover"}`}>
              {icon}
            </button>
          ))}
        </>
      )}
      {edge && (
        <>
          <Divider />
          {(
            [
              ["none-arrow", "One-way arrow", <ArrowRight size={14} />],
              ["arrow-arrow", "Two-way arrow", <span className="text-[13px]">↔</span>],
              ["none-none", "No arrows", <Minus size={14} />],
            ] as const
          ).map(([v, t, icon]) => (
            <button
              key={v}
              title={t}
              onClick={() => onArrows(v.split("-")[0] as "none" | "arrow", v.split("-")[1] as "none" | "arrow")}
              className={`flex size-7 items-center justify-center rounded-md ${arrows === v ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover"}`}
            >
              {icon}
            </button>
          ))}
          <button onClick={onLabel} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-ink">
            Label
          </button>
        </>
      )}
      <Divider />
      <button title="Delete" onClick={onDelete} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-danger">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function EdgeLabelInput({
  edge,
  data,
  toScreen,
  onChange,
  onDone,
}: {
  edge: CanvasEdge;
  data: CanvasData;
  toScreen: (p: Pt) => Pt;
  onChange: (label: string) => void;
  onDone: () => void;
}) {
  const a = data.nodes.find((n) => n.id === edge.fromNode);
  const b = data.nodes.find((n) => n.id === edge.toNode);
  if (!a || !b) return null;
  const p = toScreen({ x: (center(a).x + center(b).x) / 2, y: (center(a).y + center(b).y) / 2 });
  return (
    <input
      autoFocus
      className="cv-floating absolute z-20 w-44 -translate-x-1/2 -translate-y-1/2 rounded-md border border-accent bg-surface px-2 py-1 text-center text-[12.5px] text-ink shadow-pop outline-none"
      style={{ left: p.x, top: p.y }}
      value={edge.label ?? ""}
      placeholder="Label"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function CardMenu({
  pos,
  notebook,
  self,
  onClose,
  onPick,
}: {
  pos: Pt;
  notebook: string;
  self: string;
  onClose: () => void;
  onPick: (kind: "note" | "pdf" | "canvas", name: string) => void;
}) {
  const nb = useVault((s) => s.notebooks.find((n) => n.name === notebook));
  const [q, setQ] = useState("");
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  const items: { kind: "note" | "pdf" | "canvas"; name: string; icon: React.ReactNode; label: string }[] = [
    ...(nb?.notes ?? []).map((n) => ({ kind: "note" as const, name: n.name, icon: <FileText size={14} />, label: n.name })),
    ...(nb?.pdfs ?? []).map((p) => ({ kind: "pdf" as const, name: p.name, icon: <BookOpen size={14} />, label: p.name.replace(/\.pdf$/i, "") })),
    ...(nb?.canvases ?? []).filter((c) => c.name !== self).map((c) => ({ kind: "canvas" as const, name: c.name, icon: <Network size={14} />, label: c.name })),
  ].filter((i) => match(i.label));
  return (
    <Floating x={pos.x} y={pos.y} onClose={onClose} className="cv-floating w-[280px] p-1">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items[0]) onPick(items[0].kind, items[0].name);
          if (e.key === "Escape") onClose();
        }}
        placeholder="Add a card for…"
        className="mb-1 w-full rounded-md bg-hover px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint"
      />
      <div className="max-h-[300px] overflow-y-auto">
        {items.length === 0 && <div className="px-2.5 py-3 text-center text-[12.5px] text-faint">Nothing to add</div>}
        {items.map((i) => (
          <button
            key={i.kind + i.name}
            onClick={() => onPick(i.kind, i.name)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-hover"
          >
            <span className="text-faint">{i.icon}</span>
            <span className="truncate">{i.label}</span>
          </button>
        ))}
      </div>
    </Floating>
  );
}
