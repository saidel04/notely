import {
  ArrowRight,
  Circle,
  Diamond,
  Download,
  Eraser,
  FileText,
  Group as GroupIcon,
  Hand,
  ImagePlus,
  LayoutGrid,
  Link2,
  Maximize2,
  Minus,
  MousePointer2,
  Network,
  PenLine,
  Plus,
  Redo2,
  RectangleHorizontal,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
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
import { assetUrl, saveImageFile } from "../../lib/assets";
import { DraggedQuote, ITEM_MIME, QUOTE_MIME } from "../../lib/dragQuote";
import { canvasDrops } from "../../lib/editorRegistry";
import { isImagePath, pixelDensity } from "../../lib/images";
import { strokeNode } from "../../lib/ink";
import { LinkTarget } from "../../lib/linkTargets";
import { formatLink, parseLinks, qualify } from "../../lib/links";
import { errorMessage, vaultApi } from "../../lib/vault";
import { followLink } from "../../lib/navigate";
import { settings, setSettingSoon } from "../../lib/settings";
import { canvasHistory } from "../../lib/canvasHistory";
import { useCanvases } from "../../store/canvasStore";
import { useUi } from "../../store/uiStore";
import { PaneIndex } from "../../store/workspaceStore";
import { LinkPicker } from "../editor/LinkPicker";
import { Menu } from "../ui/Menu";
import { CanvasScene } from "./CanvasScene";

type Tool = "select" | "hand" | Shape | "group" | "pen" | "eraser";
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
  | { kind: "create"; tool: Shape | "group"; start: Pt }
  | { kind: "draw"; points: Pt[] }
  | { kind: "erase"; snapshot: CanvasData; erased: boolean };

/** Pen sizes: fine, medium, bold. */
const PEN_WIDTHS = [2, 4, 8];
/** Widest an image is placed (it can be resized afterwards). */
const MAX_IMAGE_WIDTH = 480;

/** Where the link picker is open, and what picking does. */
type Picking =
  | { mode: "card"; at: Pt }
  | { mode: "link"; at: Pt; node: string }
  | { mode: "inline"; at: Pt; node: string; from: number; to: number };

/** Link text sits inside `[[…|text]]`, which can't hold brackets, pipes or newlines. */
const cleanAlias = (s: string) => s.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim();

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
  const [picking, setPicking] = useState<Picking | null>(null);
  const [exportMenu, setExportMenu] = useState<Pt | null>(null);
  const [space, setSpace] = useState(false);
  const [pen, setPen] = useState<{ color?: string; width: number }>({ width: PEN_WIDTHS[1] });
  const [ink, setInk] = useState<Pt[] | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag | null>(null);
  // Mirrors drag.current for rendering (refs don't re-render).
  const [dragKind, setDragKind] = useState<Drag["kind"] | null>(null);
  const editSnapshot = useRef<CanvasData | null>(null);
  // Node id currently being created (so its text becomes part of one undo step).
  const creating = useRef<string | null>(null);
  const viewKey = `cview:${notebook}/${name}`;

  const dataRef = useRef(data);
  dataRef.current = data;
  const store = useCanvases.getState();

  // ---------- data changes ----------
  const live = useCallback((next: CanvasData) => store.set(name, next), [name, store]);
  const commit = useCallback(
    (next: CanvasData, snapshot: CanvasData = dataRef.current) => {
      canvasHistory.record(notebook, name, snapshot, next);
      store.set(name, next);
    },
    [notebook, name, store],
  );
  // History lives outside the component (it survives closing the canvas) and
  // undoes per element, so edits made meanwhile by an agent are kept.
  const doUndo = () => {
    const prev = canvasHistory.undo(notebook, name, dataRef.current);
    if (prev) store.set(name, prev);
  };
  const doRedo = () => {
    const next = canvasHistory.redo(notebook, name, dataRef.current);
    if (next) store.set(name, next);
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
    const nextDoc = { nodes: [...d.nodes, node], edges };
    if (opts.edit) {
      // Defer history: the add and any text typed into it commit as one step when
      // editing ends (and the node is simply dropped if left empty).
      editSnapshot.current = opts.snapshot ?? d;
      creating.current = node.id;
      live(nextDoc);
    } else {
      commit(nextDoc, opts.snapshot ?? d);
    }
    setSel({ nodes: new Set([node.id]), edges: new Set() });
    if (opts.edit) setEditing(node.id);
  };

  const newShape = (shape: Shape | "group", at: Pt, size?: { width: number; height: number }): CanvasNode => {
    const s = size ?? TOOL_SIZE[shape];
    const base = { id: newId(), x: snap(at.x - s.width / 2), y: snap(at.y - s.height / 2), width: snap(s.width), height: snap(s.height) };
    return shape === "group" ? { ...base, type: "group", label: "Group" } : { ...base, type: "text", text: "", shape };
  };

  const viewCenter = () => {
    const el = host.current!.getBoundingClientRect();
    return toWorld(el.left + el.width / 2, el.top + el.height / 2);
  };

  /** A card for a note, PDF or canvas — or, with a `#subpath`, a page, quote or bookmark in a PDF. */
  const addCard = (kind: "note" | "pdf" | "canvas", item: string, at?: Pt, opts: { notebook?: string; subpath?: string } = {}) => {
    const p = at ?? viewCenter();
    const size = kind === "note" ? { width: 300, height: 200 } : opts.subpath ? { width: 280, height: 130 } : { width: 260, height: 90 };
    addNode({
      id: newId(),
      type: "file",
      file: fileNodePath(opts.notebook ?? notebook, kind, item),
      ...(opts.subpath ? { subpath: opts.subpath } : {}),
      x: snap(p.x - size.width / 2),
      y: snap(p.y - size.height / 2),
      ...size,
    });
  };

  /** Image cards for files already in `_assets/`, placed side by side around `at`. */
  const addImages = async (names: string[], at: Pt = viewCenter()) => {
    const nodes: CanvasNode[] = [];
    let x = at.x;
    for (const file of names) {
      // Natural size (halved for "@2x" figures), capped so big photos stay manageable.
      const dims = await assetUrl(notebook, file)
        .then((u) => new Promise<{ w: number; h: number }>((ok, fail) => {
          const img = new Image();
          img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = fail;
          img.src = u;
        }))
        .catch(() => ({ w: 320, h: 240 }));
      const d = pixelDensity(file);
      let width = Math.max(40, dims.w / d);
      let height = Math.max(30, dims.h / d);
      if (width > MAX_IMAGE_WIDTH) [width, height] = [MAX_IMAGE_WIDTH, (height * MAX_IMAGE_WIDTH) / width];
      nodes.push({ id: newId(), type: "file", file: fileNodePath(notebook, "image", file), x: Math.round(x - (names.length === 1 ? width / 2 : 0)), y: Math.round(at.y - height / 2), width: Math.round(width), height: Math.round(height) });
      x += width + 30;
    }
    if (!nodes.length) return;
    const d = dataRef.current;
    commit({ ...d, nodes: [...d.nodes, ...nodes] });
    setSel({ nodes: new Set(nodes.map((n) => n.id)), edges: new Set() });
    setTool("select");
  };

  const chooseImages = async () => {
    const picked = await open({ multiple: true, title: "Add images", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] }] });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (!paths.length) return;
    try {
      const names: string[] = [];
      for (const p of paths) names.push(await vaultApi.importAsset(notebook, p));
      await addImages(names);
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  };

  // Images dropped from Explorer onto this canvas (routed here by the app's file-drop handler).
  const addImagesRef = useRef(addImages);
  addImagesRef.current = addImages;
  const toWorldRef = useRef(toWorld);
  toWorldRef.current = toWorld;
  useEffect(() => {
    const drop = async (paths: string[], at?: Pt) => {
      try {
        const names: string[] = [];
        for (const p of paths.filter(isImagePath)) names.push(await vaultApi.importAsset(notebook, p));
        await addImagesRef.current(names, at ? toWorldRef.current(at.x, at.y) : undefined);
      } catch (e) {
        useUi.getState().toast(errorMessage(e), "error");
      }
    };
    canvasDrops.set(pane, drop);
    return () => {
      if (canvasDrops.get(pane) === drop) canvasDrops.delete(pane);
    };
  }, [notebook, pane]);

  /** Pasted screenshots become image cards in the middle of the view. */
  const onPaste = async (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement).closest("textarea, input")) return;
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    try {
      const names: string[] = [];
      for (const f of files) names.push(await saveImageFile(notebook, f));
      await addImages(names);
    } catch (err) {
      useUi.getState().toast(errorMessage(err), "error");
    }
  };

  /** Picking from the link picker: a new card, a link on a box, or a link typed after `[[`. */
  const onPicked = (t: LinkTarget) => {
    const p = picking;
    setPicking(null);
    if (!p) return;
    const target = t.target;
    if (p.mode === "card") {
      // Targets in other notebooks come as "Notebook/name".
      const slash = target.indexOf("/");
      const other = t.detail?.startsWith("in ") && slash > 0;
      const nb = other ? target.slice(0, slash) : notebook;
      const item = other ? target.slice(slash + 1) : target;
      const kind = t.kind === "note" ? "note" : t.kind === "canvas" ? "canvas" : "pdf";
      const itemName = kind === "canvas" ? item.replace(/\.canvas$/i, "") : item;
      if (kind === "canvas" && itemName === name && nb === notebook) return;
      addCard(kind, itemName, undefined, { notebook: nb, subpath: t.fragment ? `#${t.fragment}` : undefined });
      return;
    }
    const n = dataRef.current.nodes.find((x) => x.id === p.node);
    if (!n || n.type !== "text") return;
    if (p.mode === "inline") {
      const link = formatLink(target, t.fragment);
      const text = n.text.slice(0, p.from) + link + n.text.slice(p.to);
      live(patchNode(n.id, { text } as Partial<CanvasNode>));
      requestAnimationFrame(() => {
        const el = textarea.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(p.from + link.length, p.from + link.length);
      });
      return;
    }
    // Link a whole box: its words become the link's text (a box that's
    // already one link is re-pointed; a long or multi-line box gets the link on a new line).
    const existing = parseLinks(n.text);
    const whole = existing.length === 1 && existing[0].from === 0 && existing[0].to === n.text.trim().length;
    const words = whole ? (existing[0].alias ?? "") : n.text.trim();
    const short = !words.includes("\n") && words.length <= 120;
    const label = short ? cleanAlias(words) : "";
    const link = formatLink(target, t.fragment, label || (whole ? null : t.label.slice(0, 60)) || null);
    commit(patchNode(n.id, { text: short ? link : `${n.text.trimEnd()}\n\n${link}` } as Partial<CanvasNode>));
  };

  /** Opens the picker to link the selected box. */
  const linkBox = (id: string, at: Pt) => setPicking({ mode: "link", node: id, at });

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
    if (!t || t.kind === "image") return;
    const name = t.kind === "canvas" ? `${t.name}.canvas` : t.name;
    // Same path as clicking a link, so cards into other notebooks (and a
    // card's page or quote) work too.
    const link = parseLinks(formatLink(qualify(name, t.notebook, notebook), n.subpath?.replace(/^#/, "") || null))[0];
    void followLink(link, pane, false);
  };

  // ---------- pointer interaction ----------
  const nodeAt = (clientX: number, clientY: number, exclude?: string): CanvasNode | null => {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const id = (el as Element).closest?.("[data-node]")?.getAttribute("data-node");
      if (id && id !== exclude) {
        const n = dataRef.current.nodes.find((x) => x.id === id);
        if (n && n.type !== "group" && n.type !== "drawing") return n;
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
    if (tool === "pen") {
      drag.current = { kind: "draw", points: [p] };
      setInk([p]);
      return;
    }
    if (tool === "eraser") {
      const dr: Drag = { kind: "erase", snapshot: d, erased: false };
      drag.current = dr;
      eraseAt(dr, e.clientX, e.clientY);
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

  /** The eraser removes pen strokes it touches (only strokes, so boxes are safe). */
  const eraseAt = (dr: Extract<Drag, { kind: "erase" }>, clientX: number, clientY: number) => {
    const d = dataRef.current;
    const hit = new Set<string>();
    // A small square around the pointer, so quick sweeps don't skip strokes.
    for (const [dx, dy] of [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5]]) {
      for (const el of document.elementsFromPoint(clientX + dx, clientY + dy)) {
        const id = el.closest?.("[data-node]")?.getAttribute("data-node");
        if (id && d.nodes.find((n) => n.id === id)?.type === "drawing") hit.add(id);
      }
    }
    if (!hit.size) return;
    dr.erased = true;
    live({ ...d, nodes: d.nodes.filter((n) => !hit.has(n.id)) });
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
        // Images keep their proportions (hold Shift to stretch).
        if (o.type === "file" && fileNodeTarget(o.file, notebook)?.kind === "image" && !e.shiftKey) {
          const ratio = o.width / o.height;
          height = Math.max(20, Math.round(width / ratio));
          if (dr.corner.includes("n")) y = o.y + o.height - height;
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
      case "draw": {
        // Coalesced events keep fast strokes smooth.
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        const pts = events.length ? events.map((ev) => toWorld(ev.clientX, ev.clientY)) : [p];
        dr.points.push(...pts);
        setInk([...dr.points]);
        break;
      }
      case "erase":
        eraseAt(dr, e.clientX, e.clientY);
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
      case "draw": {
        setInk(null);
        // The pen stays active, so you can keep writing.
        const node = strokeNode(dr.points, pen.width, pen.color, view.k);
        if (node) commit({ ...d, nodes: [...d.nodes, node] });
        break;
      }
      case "erase":
        if (dr.erased) commit(d, dr.snapshot);
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".cv-editor, .cv-toolbar, .cv-floating")) return;
    const t = e.target as Element;
    const nodeId = t.closest("[data-node]")?.getAttribute("data-node");
    const edgeId = t.closest("[data-edge]")?.getAttribute("data-edge");
    // Double-click a [[link]] in a box to follow it.
    const wiki = t.closest("[data-link]");
    if (wiki) {
      const link = parseLinks(decodeURIComponent(wiki.getAttribute("data-link")!))[0];
      if (link) void followLink(link, pane, e.ctrlKey || e.metaKey);
      return;
    }
    if (tool === "pen" || tool === "eraser") return;
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
      else if (n?.type === "text" || n?.type === "group") {
        editSnapshot.current = dataRef.current;
        setEditing(id);
      }
    } else if (k.startsWith("arrow")) {
      const nodes = dataRef.current.nodes;
      if (!sel.nodes.size) {
        // Nothing selected yet: an arrow key picks the first shape (keyboard entry).
        if (!nodes.length) return;
        setSel({ nodes: new Set([nodes[0].id]), edges: new Set() });
      } else {
        const step = e.shiftKey ? GRID * 5 : GRID;
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
        const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
        const d = dataRef.current;
        commit({ ...d, nodes: d.nodes.map((n) => (sel.nodes.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) });
      }
    } else if (k === "tab") {
      // Cycle the selection through shapes. Only while something is selected, so
      // Tab still moves focus out of the canvas when nothing is selected (Escape
      // clears the selection) — no focus trap.
      const nodes = dataRef.current.nodes;
      if (!nodes.length || !sel.nodes.size) return;
      const curr = nodes.findIndex((n) => sel.nodes.has(n.id));
      const next = (curr + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      setSel({ nodes: new Set([nodes[next].id]), edges: new Set() });
    } else if (!mod && k === "v") setTool("select");
    else if (!mod && k === "h") setTool("hand");
    else if (!mod && k === "r") setTool("rounded");
    else if (!mod && k === "o") setTool("ellipse");
    else if (!mod && k === "d") setTool("diamond");
    else if (!mod && k === "g") setTool("group");
    else if (!mod && k === "p") setTool("pen");
    else if (!mod && k === "e") setTool("eraser");
    else if (mod && e.shiftKey && k === "k" && selectedText) linkBox(selectedText.id, toolbarAnchor());
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
    const wasNew = creating.current === editing;
    editSnapshot.current = null;
    creating.current = null;
    setEditing(null);
    if (!n) return;
    if (n.type === "text" && !n.text.trim() && wasNew) {
      // A new node left empty: drop it (and the edge that created it). Its add was
      // never recorded, so there's nothing to undo.
      const d = dataRef.current;
      store.set(name, { nodes: d.nodes.filter((x) => x.id !== n.id), edges: d.edges.filter((x) => x.fromNode !== n.id && x.toNode !== n.id) });
      return;
    }
    // One step for an edit, or for a new node's whole creation (snapshot = the doc before it).
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
  const selectedText = selectedNode?.type === "text" ? selectedNode : null;
  /** Under the selected box, in window coordinates (where the link picker opens). */
  const toolbarAnchor = (): Pt => {
    const r = host.current!.getBoundingClientRect();
    const b = selectionBox ?? { x: 0, y: 0, width: 0, height: 0 };
    const p = { x: b.x * view.k + view.x, y: (b.y + b.height) * view.k + view.y };
    return { x: r.left + Math.max(8, p.x), y: r.top + Math.min(r.height - 40, p.y + 10) };
  };
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

  const cursor =
    space || tool === "hand"
      ? dragKind === "pan"
        ? "grabbing"
        : "grab"
      : tool === "select"
        ? "default"
        : tool === "eraser"
          ? "cell"
          : "crosshair";
  const toScreen = (p: Pt) => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y });

  return (
    <div
      ref={host}
      tabIndex={0}
      role="application"
      aria-label={`Diagram canvas: ${name}. Press an arrow key to select a shape, Tab to move between shapes, Enter to edit, Delete to remove.`}
      className="cv relative h-full overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
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
      onPaste={(e) => void onPaste(e)}
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
            pendingInk={ink ? { points: ink, color: pen.color, width: pen.width } : null}
            hoverId={hover}
            interactive
          />

          {/* Resize handles + connection ports */}
          {selectedNode && !editing && <Handles node={selectedNode} k={view.k} />}
          {data.nodes
            .filter((n) => n.type !== "group" && n.type !== "drawing" && (n.id === hover || sel.nodes.has(n.id)) && tool === "select" && !editing)
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
                ref={textarea}
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
                  // Typing "[[" opens the link picker; what's picked replaces the brackets.
                  const caret = e.target.selectionStart;
                  if (editingNode.type === "text" && v.slice(caret - 2, caret) === "[[" && v.length > editingNode.text.length) {
                    const r = e.target.getBoundingClientRect();
                    setPicking({ mode: "inline", node: editingNode.id, from: caret - 2, to: caret, at: { x: r.left, y: r.bottom + 6 } });
                  }
                }}
                onBlur={() => picking?.mode !== "inline" && finishEditing()}
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
        <Divider />
        <ToolBtn active={tool === "pen"} title="Pen (P) — draw freehand" onClick={() => setTool("pen")}><PenLine size={15} /></ToolBtn>
        <ToolBtn active={tool === "eraser"} title="Eraser (E) — rub out pen strokes" onClick={() => setTool("eraser")}><Eraser size={15} /></ToolBtn>
        <ToolBtn title="Add images (or paste / drop them here)" onClick={() => void chooseImages()}><ImagePlus size={15} /></ToolBtn>
        <ToolBtn title="Add a card for a note, PDF page, quote or canvas" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicking({ mode: "card", at: { x: r.left, y: r.bottom + 6 } }); }}><FileText size={15} /></ToolBtn>
        <Divider />
        <ToolBtn title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!canvasHistory.canUndo(notebook, name)}><Undo2 size={15} /></ToolBtn>
        <ToolBtn title="Redo (Ctrl+Shift+Z)" onClick={doRedo} disabled={!canvasHistory.canRedo(notebook, name)}><Redo2 size={15} /></ToolBtn>
        <Divider />
        <ToolBtn title="Tidy layout — top to bottom" onClick={() => tidy("TB")}><Network size={15} /></ToolBtn>
        <ToolBtn title="Tidy layout — left to right" onClick={() => tidy("LR")}><LayoutGrid size={15} className="-rotate-90" /></ToolBtn>
        <Divider />
        <ToolBtn title="Export as PNG or SVG" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setExportMenu({ x: r.right - 200, y: r.bottom + 6 }); }}><Download size={15} /></ToolBtn>
      </div>

      {/* Pen options */}
      {tool === "pen" && (
        <div className="cv-toolbar animate-pop absolute top-[58px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-pop backdrop-blur">
          {SWATCHES.map((c) => (
            <button
              key={c ?? "ink"}
              title={c ? "Pen color" : "Ink (follows the theme)"}
              aria-label={c ? `Pen color ${c}` : "Ink color"}
              onClick={() => setPen((p) => ({ ...p, color: c }))}
              className={`size-[18px] rounded-full border ${pen.color === c ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""} ${c ? "border-black/10" : "border-line-strong bg-ink"}`}
              style={c ? { background: PRESET_COLORS[c] } : undefined}
            />
          ))}
          <Divider />
          {PEN_WIDTHS.map((w) => (
            <button
              key={w}
              title={w === PEN_WIDTHS[0] ? "Fine" : w === PEN_WIDTHS[1] ? "Medium" : "Bold"}
              aria-label={`Pen size ${w}`}
              onClick={() => setPen((p) => ({ ...p, width: w }))}
              className={`flex size-7 items-center justify-center rounded-md ${pen.width === w ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover"}`}
            >
              <span className="rounded-full bg-current" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>
      )}

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
          onLink={selectedText ? () => linkBox(selectedText.id, toolbarAnchor()) : undefined}
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
              Drag notes and PDFs here from the sidebar · paste or drop images · P to draw
            </div>
          </div>
        </div>
      )}

      {picking && (
        <LinkPicker
          notebook={notebook}
          anchor={picking.at}
          selectionText=""
          heading={
            picking.mode === "card"
              ? "Add a card for…"
              : picking.mode === "link"
                ? "Link this box to…"
                : "Insert a link to…"
          }
          onPick={onPicked}
          onClose={() => {
            const p = picking;
            setPicking(null);
            // Back to typing where the brackets were.
            if (p.mode === "inline") requestAnimationFrame(() => textarea.current?.focus());
          }}
        />
      )}

      {exportMenu && (
        <Menu
          x={exportMenu.x}
          y={exportMenu.y}
          onClose={() => setExportMenu(null)}
          items={[
            { label: "Export as PNG image…", icon: <Download />, onSelect: () => void import("./canvasExport").then((m) => m.exportCanvas(dataRef.current, notebook, name, "png")) },
            { label: "Export as SVG…", icon: <Download />, onSelect: () => void import("./canvasExport").then((m) => m.exportCanvas(dataRef.current, notebook, name, "svg")) },
          ]}
        />
      )}
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
  onLink,
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
  /** Link the box to a note, PDF page, quote… (text boxes only). */
  onLink?: () => void;
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
      {onLink && (
        <>
          <Divider />
          <button title="Link to a note, PDF page or quote (Ctrl+Shift+K)" onClick={onLink} className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-ink">
            <Link2 size={14} /> Link
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
