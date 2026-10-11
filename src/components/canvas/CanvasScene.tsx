import { BookOpen, Bookmark, FileText, Link2, Network } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { assetUrl } from "../../lib/assets";
import { CanvasData, CanvasEdge, CanvasNode, colorHex, DrawingNode, edgeGeometry, fileNodeTarget, Side } from "../../lib/canvas";
import { drawingPath, smoothPath } from "../../lib/ink";
import { displayText, parseLinks } from "../../lib/links";
import { hlKey, useHighlights } from "../../store/highlightStore";
import { renderMarkdown } from "../../lib/markdown";
import { parseTags } from "../../lib/tags";
import { useVault } from "../../store/vaultStore";

export interface SceneProps {
  data: CanvasData;
  notebook: string;
  selectedNodes?: Set<string>;
  selectedEdges?: Set<string>;
  editingId?: string | null;
  /** Live preview of an edge being drawn. */
  pendingEdge?: { from: CanvasNode; fromSide: Side; to: { x: number; y: number } } | null;
  /** Live preview of a pen stroke being drawn. */
  pendingInk?: { points: { x: number; y: number }[]; color?: string; width: number } | null;
  hoverId?: string | null;
  interactive?: boolean;
}

const tint = (hex: string, alpha: number) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export const NODE_RADIUS = 10;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** [[links]] in canvas text become clickable spans (Ctrl+click follows them). */
function linksToHtml(text: string) {
  return parseLinks(text)
    .reverse()
    .reduce(
      (s, l) =>
        s.slice(0, l.from) +
        `<span class="cv-wikilink" data-link="${encodeURIComponent(l.raw)}" title="Ctrl+click to open">${escapeHtml(displayText(l))}</span>` +
        s.slice(l.to),
      text,
    );
}

/** #tags in canvas text become pills (Ctrl+click filters by the tag). */
function tagsToHtml(text: string) {
  return parseTags(text)
    .reverse()
    .reduce((s, t) => s.slice(0, t.from) + `<span class="cv-tag" data-tag="${escapeHtml(t.tag)}">#${escapeHtml(t.tag)}</span>` + s.slice(t.to), text);
}

/** Shows [[links]] in card previews as their display text (bold), not raw syntax. */
function readableLinks(text: string) {
  return parseLinks(text)
    .reverse()
    .reduce((s, l) => s.slice(0, l.from) + `**${displayText(l)}**` + s.slice(l.to), text);
}

/** Static drawing of a canvas in world coordinates (the caller supplies the transform). */
export const CanvasScene = memo(function CanvasScene({
  data,
  notebook,
  selectedNodes,
  selectedEdges,
  editingId,
  pendingEdge,
  pendingInk,
  hoverId,
  interactive,
}: SceneProps) {
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  // Groups first so they sit behind everything else.
  const ordered = useMemo(
    () => [...data.nodes.filter((n) => n.type === "group"), ...data.nodes.filter((n) => n.type !== "group")],
    [data.nodes],
  );

  return (
    <>
      {ordered
        .filter((n) => n.type === "group")
        .map((n) => (
          <NodeView key={n.id} node={n} notebook={notebook} selected={!!selectedNodes?.has(n.id)} editing={editingId === n.id} hover={hoverId === n.id} interactive={interactive} />
        ))}
      <g>
        {data.edges.map((e) => {
          const a = byId.get(e.fromNode);
          const b = byId.get(e.toNode);
          return a && b ? <EdgeView key={e.id} edge={e} from={a} to={b} selected={!!selectedEdges?.has(e.id)} interactive={interactive} /> : null;
        })}
        {pendingEdge && <PendingEdge {...pendingEdge} />}
      </g>
      {ordered
        .filter((n) => n.type !== "group")
        .map((n) => (
          <NodeView key={n.id} node={n} notebook={notebook} selected={!!selectedNodes?.has(n.id)} editing={editingId === n.id} hover={hoverId === n.id} interactive={interactive} />
        ))}
      {pendingInk && (
        <path
          d={smoothPath(pendingInk.points)}
          stroke={colorHex(pendingInk.color) ?? "var(--text)"}
          strokeWidth={pendingInk.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
    </>
  );
});

function Arrow({ at, angle, color }: { at: { x: number; y: number }; angle: number; color: string }) {
  const s = 9;
  const p = (a: number, r: number) => `${at.x + Math.cos(a) * r},${at.y + Math.sin(a) * r}`;
  return <polygon points={`${at.x},${at.y} ${p(angle + Math.PI - 0.42, s)} ${p(angle + Math.PI + 0.42, s)}`} fill={color} />;
}

const EdgeView = memo(function EdgeView({
  edge,
  from,
  to,
  selected,
  interactive,
}: {
  edge: CanvasEdge;
  from: CanvasNode;
  to: CanvasNode;
  selected: boolean;
  interactive?: boolean;
}) {
  const g = edgeGeometry(from, to, edge);
  const color = colorHex(edge.color) ?? "var(--cv-edge)";
  const stroke = selected ? "var(--accent)" : color;
  const label = edge.label?.trim();
  const labelW = label ? Math.min(220, label.length * 7 + 16) : 0;
  return (
    <g data-edge={edge.id} className={interactive ? "cv-edge" : undefined}>
      {interactive && <path d={g.path} stroke="transparent" strokeWidth={14} fill="none" />}
      <path d={g.path} stroke={stroke} strokeWidth={selected ? 2.4 : 1.8} fill="none" />
      {(edge.toEnd ?? "arrow") === "arrow" && <Arrow at={g.end} angle={g.endAngle} color={stroke} />}
      {edge.fromEnd === "arrow" && <Arrow at={g.start} angle={g.startAngle} color={stroke} />}
      {label && (
        <foreignObject x={g.mid.x - labelW / 2} y={g.mid.y - 13} width={labelW} height={26} style={{ overflow: "visible" }}>
          <div className="cv-edge-label">{label}</div>
        </foreignObject>
      )}
    </g>
  );
});

function PendingEdge({ from, fromSide, to }: { from: CanvasNode; fromSide: Side; to: { x: number; y: number } }) {
  const ghost: CanvasNode = { id: "_", type: "text", text: "", x: to.x - 1, y: to.y - 1, width: 2, height: 2 };
  const g = edgeGeometry(from, ghost, { fromSide });
  return (
    <g pointerEvents="none">
      <path d={g.path} stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" fill="none" />
      <Arrow at={g.end} angle={g.endAngle} color="var(--accent)" />
    </g>
  );
}

function shapePath(n: CanvasNode) {
  const { x, y, width: w, height: h } = n;
  const shape = n.type === "text" ? (n.shape ?? "rounded") : "rounded";
  switch (shape) {
    case "ellipse":
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
    case "diamond":
      return <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />;
    case "rectangle":
      return <rect x={x} y={y} width={w} height={h} rx={2} />;
    default:
      return <rect x={x} y={y} width={w} height={h} rx={NODE_RADIUS} />;
  }
}

const NodeView = memo(function NodeView({
  node,
  notebook,
  selected,
  editing,
  hover,
  interactive,
}: {
  node: CanvasNode;
  notebook: string;
  selected: boolean;
  editing: boolean;
  hover: boolean;
  interactive?: boolean;
}) {
  const hex = colorHex(node.color);
  const { x, y, width: w, height: h } = node;

  if (node.type === "group") {
    return (
      <g data-node={node.id} className="cv-node">
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={14}
          fill={hex ? tint(hex, 0.07) : "var(--cv-group)"}
          stroke={selected ? "var(--accent)" : hex ? tint(hex, 0.55) : "var(--border-strong)"}
          strokeWidth={selected ? 2 : 1.2}
          strokeDasharray={hex ? undefined : "6 5"}
        />
        {node.label && !editing && (
          <text x={x + 12} y={y - 8} className="cv-group-label" fill={hex ?? "var(--text-muted)"}>
            {node.label}
          </text>
        )}
      </g>
    );
  }

  if (node.type === "drawing") return <DrawingView node={node} selected={selected} interactive={interactive} />;

  const image = node.type === "file" ? fileNodeTarget(node.file, notebook) : null;
  if (image?.kind === "image") {
    return (
      <g data-node={node.id} className="cv-node">
        <ImageView node={node} notebook={image.notebook} name={image.name} />
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={4}
          fill="transparent"
          stroke={selected ? "var(--accent)" : hover ? "var(--border-strong)" : "transparent"}
          strokeWidth={selected ? 2 : 1}
          className={interactive ? "cv-shape" : undefined}
        />
      </g>
    );
  }

  const fill = hex ? tint(hex, 0.13) : "var(--cv-node)";
  const stroke = selected ? "var(--accent)" : hex ?? (hover ? "var(--text-faint)" : "var(--cv-border)");
  const inset = node.type === "text" && node.shape === "diamond" ? { x: w * 0.2, y: h * 0.22 } : node.type === "text" && node.shape === "ellipse" ? { x: w * 0.12, y: h * 0.12 } : { x: 0, y: 0 };

  return (
    <g data-node={node.id} className="cv-node">
      <g fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.3} className={interactive ? "cv-shape" : undefined}>
        {shapePath(node)}
      </g>
      {!editing && (
        <foreignObject x={x + inset.x} y={y + inset.y} width={Math.max(10, w - inset.x * 2)} height={Math.max(10, h - inset.y * 2)}>
          <NodeBody node={node} notebook={notebook} />
        </foreignObject>
      )}
    </g>
  );
});

function NodeBody({ node, notebook }: { node: CanvasNode; notebook: string }) {
  if (node.type === "text") {
    const centered = node.shape === "ellipse" || node.shape === "diamond" || node.text.length < 60;
    return (
      <div
        className={`cv-text ${centered ? "cv-center" : ""}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(tagsToHtml(linksToHtml(node.text || ""))) }}
      />
    );
  }
  if (node.type === "link") {
    return (
      <div className="cv-card">
        <div className="cv-card-title">
          <Link2 size={13} /> Link
        </div>
        <div className="cv-card-body break-all">{node.url}</div>
      </div>
    );
  }
  if (node.type === "file") return <FileCard file={node.file} subpath={node.subpath} notebook={notebook} />;
  return null;
}

/** A pen stroke; a wide invisible stroke underneath makes thin lines easy to click. */
function DrawingView({ node, selected, interactive }: { node: DrawingNode; selected: boolean; interactive?: boolean }) {
  const d = drawingPath(node);
  const width = node.strokeWidth ?? 3;
  return (
    <g data-node={node.id} className="cv-node">
      {selected && (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={4} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
      )}
      {interactive && <path d={d} stroke="transparent" strokeWidth={width + 12} fill="none" strokeLinecap="round" className="cv-ink-hit" />}
      <path
        d={d}
        stroke={colorHex(node.color) ?? "var(--text)"}
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
    </g>
  );
}

/** An image from a notebook's `_assets/`, fitted inside its box. */
function ImageView({ node, notebook, name }: { node: CanvasNode; notebook: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    assetUrl(notebook, name).then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => void (live = false);
  }, [notebook, name]);
  if (failed) {
    return (
      <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}>
        <div className="cv-card cv-missing">
          <div className="cv-card-body text-faint">Image not found: {name}</div>
        </div>
      </foreignObject>
    );
  }
  if (!url) return <rect data-loading x={node.x} y={node.y} width={node.width} height={node.height} rx={4} fill="var(--bg-hover)" />;
  return <image href={url} x={node.x} y={node.y} width={node.width} height={node.height} preserveAspectRatio="xMidYMid meet" />;
}

/** What a card's `#subpath` points at inside a PDF: a page, a highlight or a bookmark. */
function PdfPlace({ notebook, pdf, subpath }: { notebook: string; pdf: string; subpath: string }) {
  const frag = subpath.replace(/^#/, "");
  const k = hlKey(notebook, pdf);
  const hl = useHighlights((s) => (frag.startsWith("hl-") ? s.byPdf[k]?.find((h) => h.id === frag) : undefined));
  const bm = useHighlights((s) => (frag.startsWith("bm-") ? s.bookmarks[k]?.find((b) => b.id === frag) : undefined));
  useEffect(() => {
    if (frag.startsWith("hl-") || frag.startsWith("bm-")) void useHighlights.getState().ensure(notebook, pdf);
  }, [notebook, pdf, frag]);
  const page = /^page=(\d+)$/i.exec(frag)?.[1];
  if (page) return <div className="cv-card-body text-muted">Page {page}</div>;
  if (hl) {
    return (
      <div className="cv-card-body">
        <div className="cv-quote" data-color={hl.color}>“{hl.text}”</div>
        <div className="mt-1 text-[11.5px] text-faint">p. {hl.page}</div>
      </div>
    );
  }
  if (bm) {
    return (
      <div className="cv-card-body flex items-center gap-1.5 text-muted">
        <Bookmark size={12} /> {bm.name} · p. {bm.page}
      </div>
    );
  }
  return <div className="cv-card-body text-faint">PDF</div>;
}

function FileCard({ file, subpath, notebook }: { file: string; subpath?: string; notebook: string }) {
  const target = fileNodeTarget(file, notebook);
  const local = !!target && target.notebook.toLowerCase() === notebook.toLowerCase();
  const body = useVault((s) => (target?.kind === "note" && local ? s.contents[target.name] : undefined));
  const exists = useVault((s) => {
    const nb = s.notebooks.find((n) => n.name.toLowerCase() === (target?.notebook ?? notebook).toLowerCase());
    if (!nb || !target) return false;
    const list = target.kind === "note" ? nb.notes : target.kind === "pdf" ? nb.pdfs : nb.canvases;
    return list.some((i) => i.name.toLowerCase() === target.name.toLowerCase());
  });
  if (!target) {
    return (
      <div className="cv-card">
        <div className="cv-card-title">
          <FileText size={13} /> <span className="truncate">{file}</span>
        </div>
        <div className="cv-card-body text-faint">Unrecognized path</div>
      </div>
    );
  }
  const icon = target.kind === "note" ? <FileText size={13} /> : target.kind === "pdf" ? <BookOpen size={13} /> : <Network size={13} />;
  const title = (local ? "" : `${target.notebook} › `) + (target.kind === "pdf" ? target.name.replace(/\.pdf$/i, "") : target.name);
  return (
    <div className={`cv-card ${exists ? "" : "cv-missing"}`}>
      <div className="cv-card-title">
        <span>{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      {target.kind === "pdf" && subpath && exists ? (
        <PdfPlace notebook={target.notebook} pdf={target.name} subpath={subpath} />
      ) : target.kind === "note" && body !== undefined ? (
        <div className="cv-card-body cv-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(readableLinks(body.slice(0, 600))) }} />
      ) : (
        <div className="cv-card-body text-faint">{exists ? (target.kind === "pdf" ? "PDF" : "Canvas") : "Not found"}</div>
      )}
    </div>
  );
}
