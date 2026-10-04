import { BookOpen, FileText, Link2, Network } from "lucide-react";
import { memo, useMemo } from "react";
import { CanvasData, CanvasEdge, CanvasNode, colorHex, edgeGeometry, fileNodeTarget, Side } from "../../lib/canvas";
import { displayText, parseLinks } from "../../lib/links";
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
  if (node.type === "file") return <FileCard file={node.file} notebook={notebook} />;
  return null;
}

function FileCard({ file, notebook }: { file: string; notebook: string }) {
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
      {target.kind === "note" && body !== undefined ? (
        <div className="cv-card-body cv-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(readableLinks(body.slice(0, 600))) }} />
      ) : (
        <div className="cv-card-body text-faint">{exists ? (target.kind === "pdf" ? "PDF" : "Canvas") : "Not found"}</div>
      )}
    </div>
  );
}
