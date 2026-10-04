import { Maximize2, Network } from "lucide-react";
import { bounds } from "../../lib/canvas";
import { useCanvases } from "../../store/canvasStore";
import { CanvasScene } from "./CanvasScene";

/** Read-only, fit-to-box rendering of a canvas (used for embeds in notes). */
export function CanvasPreview({
  notebook,
  name,
  height = 280,
  onOpen,
  elsewhere = null,
}: {
  notebook: string;
  name: string;
  height?: number;
  /** The canvas lives in this other notebook: show a card instead of a live preview. */
  elsewhere?: string | null;
  onOpen: (side: boolean) => void;
}) {
  const data = useCanvases((s) => s.data[name]);
  const broken = useCanvases((s) => s.broken[name]);
  const b = data ? bounds(data.nodes) : null;
  const pad = 30;
  // Labels of groups sit above their box; leave room for them.
  const viewBox = b && b.width ? `${b.x - pad} ${b.y - pad - 20} ${b.width + pad * 2} ${b.height + pad * 2 + 20}` : "0 0 100 100";

  return (
    <div
      className="group/embed relative overflow-hidden rounded-xl border border-line bg-bg transition-colors hover:border-line-strong"
      style={{ height }}
      onMouseDown={(e) => {
        e.preventDefault();
        onOpen(e.ctrlKey || e.metaKey);
      }}
      title="Open canvas · Ctrl+click to open beside"
    >
      <div className="cv absolute inset-0" style={{ backgroundSize: "20px 20px" }} />
      {elsewhere ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[13px] text-muted">
          <Network size={22} className="text-accent" />
          <span>
            Diagram in <b className="font-medium text-ink">{elsewhere}</b> — click to open
          </span>
        </div>
      ) : data && data.nodes.length > 0 ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
          <CanvasScene data={data} notebook={notebook} />
        </svg>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-faint">
          {broken ? "This canvas file couldn't be read" : data ? "Empty canvas — click to start drawing" : `“${name}” not found`}
        </div>
      )}
      <div className="absolute top-2.5 left-3 flex items-center gap-1.5 rounded-md bg-surface/90 px-2 py-1 font-sans text-[12px] font-medium text-muted shadow-sm backdrop-blur">
        <Network size={13} className="text-accent" />
        {name}
      </div>
      <div className="absolute top-2.5 right-3 flex items-center gap-1 rounded-md bg-surface/90 px-2 py-1 font-sans text-[11.5px] text-muted opacity-0 shadow-sm transition-opacity group-hover/embed:opacity-100">
        <Maximize2 size={12} /> Open
      </div>
    </div>
  );
}
