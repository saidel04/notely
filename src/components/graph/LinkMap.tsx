import { drag } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, ZoomBehavior } from "d3-zoom";
import { Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { CanvasData, fileNodeTarget } from "../../lib/canvas";
import { parseLinks, sameName } from "../../lib/links";
import { useCanvases } from "../../store/canvasStore";
import { useVault } from "../../store/vaultStore";
import { PaneIndex, useWorkspace } from "../../store/workspaceStore";

type Kind = "note" | "pdf" | "canvas" | "ghost";

interface Node extends SimulationNodeDatum {
  id: string;
  kind: Kind;
  name: string;
  label: string;
  degree: number;
}

type Edge = SimulationLinkDatum<Node> & { source: string | Node; target: string | Node };

/** Node positions survive rebuilds (e.g. after adding a link) so the map doesn't jump around. */
const positions = new Map<string, { x: number; y: number }>();

function buildGraph(notebook: string, notes: string[], pdfs: string[], canvases: Record<string, CanvasData | undefined>, contents: Record<string, string>) {
  const nodes = new Map<string, Node>();
  const add = (id: string, kind: Kind, name: string, label: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, name, label, degree: 0 });
    return nodes.get(id)!;
  };
  notes.forEach((n) => add(`n:${n}`, "note", n, n));
  pdfs.forEach((p) => add(`p:${p}`, "pdf", p, p.replace(/\.pdf$/i, "")));
  Object.keys(canvases).forEach((c) => add(`c:${c}`, "canvas", c, c));

  const edges = new Map<string, Edge>();
  const connect = (source: string, target: string) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const key = [source, target].sort().join("→");
    if (edges.has(key)) return;
    edges.set(key, { source, target });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  };
  // Canvas cards count as links from the canvas to that note/PDF.
  for (const [name, data] of Object.entries(canvases)) {
    for (const n of data?.nodes ?? []) {
      if (n.type !== "file") continue;
      const t = fileNodeTarget(n.file, notebook);
      if (!t || !sameName(t.notebook, notebook)) continue;
      const match = (list: string[]) => list.find((x) => sameName(x, t.name));
      const id = t.kind === "note" ? match(notes) && `n:${match(notes)}` : t.kind === "pdf" ? match(pdfs) && `p:${match(pdfs)}` : `c:${t.name}`;
      if (id) connect(`c:${name}`, id);
    }
  }
  for (const note of notes) {
    for (const l of parseLinks(contents[note] ?? "")) {
      let target: Node;
      if (l.kind === "pdf") {
        const pdf = pdfs.find((p) => sameName(p, l.target));
        if (!pdf) continue;
        target = nodes.get(`p:${pdf}`)!;
      } else if (l.kind === "canvas") {
        const c = Object.keys(canvases).find((x) => sameName(`${x}.canvas`, l.target));
        if (!c) continue;
        target = nodes.get(`c:${c}`)!;
      } else {
        const hit = notes.find((n) => sameName(n, l.target));
        target = hit ? nodes.get(`n:${hit}`)! : add(`g:${l.target.toLowerCase()}`, "ghost", l.target, l.target);
      }
      const source = `n:${note}`;
      if (target.id === source) continue;
      const key = [source, target.id].sort().join("→");
      if (edges.has(key)) continue;
      edges.set(key, { source, target: target.id });
      nodes.get(source)!.degree++;
      target.degree++;
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const radius = (n: Node) => (n.kind === "pdf" ? 7 : 4.5) + Math.min(9, Math.sqrt(n.degree) * 2.4);

export function LinkMap({ pane }: { pane: PaneIndex }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const notebook = useVault((s) => s.notebooks.find((n) => n.name === s.activeNotebook));
  const contents = useVault((s) => s.contents);
  const otherItem = useWorkspace((s) => s.panes[pane === 0 ? 1 : 0]);

  const notes = useMemo(() => notebook?.notes.map((n) => n.name) ?? [], [notebook]);
  const pdfs = useMemo(() => notebook?.pdfs.map((p) => p.name) ?? [], [notebook]);
  const canvasData = useCanvases((s) => s.data);
  const canvases = useMemo(() => {
    const out: Record<string, CanvasData | undefined> = {};
    notebook?.canvases.forEach((c) => (out[c.name] = canvasData[c.name]));
    return out;
  }, [notebook, canvasData]);
  const built = useMemo(
    () => buildGraph(notebook?.name ?? "", notes, pdfs, canvases, contents),
    [notebook, notes, pdfs, canvases, contents],
  );

  // Only rebuild the simulation when the structure changes, not on every keystroke.
  const signature = built.nodes.map((n) => n.id).join("|") + "#" + built.edges.map((e) => `${e.source}>${e.target}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => built, [signature]);

  const activeId = otherItem
    ? otherItem.kind === "note"
      ? `n:${otherItem.name}`
      : otherItem.kind === "pdf"
        ? `p:${otherItem.name}`
        : otherItem.kind === "canvas"
          ? `c:${otherItem.name}`
          : null
    : null;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const { width, height } = svgEl.getBoundingClientRect();
    const nodes: Node[] = graph.nodes.map((n) => {
      const p = positions.get(n.id);
      return { ...n, x: p?.x ?? width / 2 + (Math.random() - 0.5) * 200, y: p?.y ?? height / 2 + (Math.random() - 0.5) * 200 };
    });
    const edges: Edge[] = graph.edges.map((e) => ({ ...e }));
    const neighbors = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      const a = e.source as string;
      const b = e.target as string;
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
    }

    const svg = select(svgEl);
    svg.selectAll("*").remove();
    const root = svg.append("g");

    const link = root
      .append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("class", "lm-edge");

    const node = root
      .append("g")
      .selectAll<SVGGElement, Node>("g")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", (d) => `lm-node lm-${d.kind}`)
      .attr("data-id", (d) => d.id);

    node
      .filter((d) => d.kind === "canvas")
      .append("polygon")
      .attr("points", (d) => {
        const r = radius(d) * 1.25;
        return `0,${-r} ${r},0 0,${r} ${-r},0`;
      });
    node
      .filter((d) => d.kind === "pdf")
      .append("rect")
      .attr("x", (d) => -radius(d))
      .attr("y", (d) => -radius(d))
      .attr("width", (d) => radius(d) * 2)
      .attr("height", (d) => radius(d) * 2)
      .attr("rx", 3);
    node
      .filter((d) => d.kind === "note" || d.kind === "ghost")
      .append("circle")
      .attr("r", radius);
    node
      .append("text")
      .attr("class", "lm-label")
      .attr("y", (d) => radius(d) + 13)
      .text((d) => (d.label.length > 34 ? d.label.slice(0, 32) + "…" : d.label));
    node.append("title").text((d) => (d.kind === "ghost" ? `${d.label} (not created yet)` : d.label));

    // ----- hover: focus a node's neighborhood -----
    node
      .on("mouseenter", (_e, d) => {
        const near = neighbors.get(d.id) ?? new Set();
        svgEl.classList.add("lm-focus");
        node.classed("lm-near", (n) => n.id === d.id || near.has(n.id));
        link.classed("lm-near", (l) => (l.source as Node).id === d.id || (l.target as Node).id === d.id);
      })
      .on("mouseleave", () => {
        svgEl.classList.remove("lm-focus");
        node.classed("lm-near", false);
        link.classed("lm-near", false);
      })
      .on("click", async (e: MouseEvent, d) => {
        if (e.defaultPrevented) return; // was a drag
        const ws = useWorkspace.getState();
        const target: PaneIndex = pane === 0 ? 1 : 0;
        if (d.kind === "pdf" || d.kind === "canvas") ws.open({ kind: d.kind, name: d.name }, { pane: target });
        else {
          const name = d.kind === "ghost" ? await useVault.getState().createNote(d.name) : d.name;
          if (name) ws.open({ kind: "note", name }, { pane: target });
        }
      });

    // ----- simulation -----
    const sim = forceSimulation(nodes)
      .force(
        "link",
        forceLink<Node, Edge>(edges)
          .id((d) => d.id)
          .distance(80)
          .strength(0.6),
      )
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(width / 2, height / 2))
      .force("x", forceX(width / 2).strength(0.04))
      .force("y", forceY(height / 2).strength(0.04))
      .force("collide", forceCollide<Node>().radius((d) => radius(d) + 10))
      .alpha(positions.size ? 0.4 : 1)
      .on("tick", () => {
        link
          .attr("x1", (d) => (d.source as Node).x!)
          .attr("y1", (d) => (d.source as Node).y!)
          .attr("x2", (d) => (d.target as Node).x!)
          .attr("y2", (d) => (d.target as Node).y!);
        node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      })
      .on("end", () => nodes.forEach((n) => positions.set(n.id, { x: n.x!, y: n.y! })));

    node.call(
      drag<SVGGElement, Node>()
        .on("start", (e, d) => {
          if (!e.active) sim.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on("end", (e, d) => {
          if (!e.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // ----- pan & zoom -----
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on("zoom", (e) => {
        root.attr("transform", e.transform.toString());
        svgEl.classList.toggle("lm-far", e.transform.k < 0.65);
      });
    svg.call(z).on("dblclick.zoom", null);
    zoomRef.current = z;

    fitRef.current = () => {
      if (!nodes.length) return;
      const xs = nodes.map((n) => n.x!);
      const ys = nodes.map((n) => n.y!);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const { width: w, height: h } = svgEl.getBoundingClientRect();
      const k = Math.min(1.25, 0.85 / Math.max((x1 - x0 + 80) / w, (y1 - y0 + 80) / h));
      svg.call(z.transform, zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    };
    const fitTimer = window.setTimeout(() => fitRef.current(), positions.size ? 50 : 900);

    return () => {
      window.clearTimeout(fitTimer);
      sim.stop();
      nodes.forEach((n) => positions.set(n.id, { x: n.x!, y: n.y! }));
    };
  }, [graph, pane]);

  // Mark the item open beside the map.
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    svgEl.querySelectorAll(".lm-active").forEach((el) => el.classList.remove("lm-active"));
    if (activeId) svgEl.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.classList.add("lm-active");
  }, [activeId, graph]);

  const linkCount = graph.edges.length;

  return (
    <div className="relative h-full overflow-hidden bg-bg">
      <svg ref={svgRef} className="lm h-full w-full cursor-grab active:cursor-grabbing" />

      {linkCount === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
          <div className="text-[14px] font-medium text-ink">No links yet</div>
          <div className="mt-1 text-[12.5px] text-faint">
            Type <span className="rounded bg-hover px-1 font-mono">[[</span> in a note to connect it to another note or a PDF
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 flex items-center gap-4 rounded-full border border-line bg-surface/90 px-3.5 py-1.5 text-[11.5px] text-muted backdrop-blur">
        <Legend shape="circle" label="Note" />
        <Legend shape="square" label="PDF" />
        <Legend shape="diamond" label="Canvas" />
        <Legend shape="ghost" label="Not created" />
        <span className="text-faint">
          {graph.nodes.length} items · {linkCount} links
        </span>
      </div>

      <button
        title="Fit to view"
        onClick={() => fitRef.current()}
        className="absolute right-4 bottom-4 flex size-8 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-ink"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}

function Legend({ shape, label }: { shape: "circle" | "square" | "diamond" | "ghost"; label: string }) {
  if (shape === "diamond") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2 rotate-45 bg-[var(--lm-canvas)]" />
        {label}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block size-2.5 ${shape === "square" ? "rounded-[2px] bg-[var(--lm-pdf)]" : "rounded-full"} ${
          shape === "circle" ? "bg-[var(--lm-note)]" : ""
        } ${shape === "ghost" ? "border border-dashed border-faint" : ""}`}
      />
      {label}
    </span>
  );
}
