import {
  BookOpen,
  Columns2,
  Download,
  FilePlus2,
  FileText,
  MoreHorizontal,
  Network,
  Plus,
  Printer,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { actions } from "../../lib/actions";
import { exportHighlights, exportNoteMarkdown, noteFromHighlights, printNote } from "../../lib/exporting";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { PaneIndex, PaneItem, useWorkspace } from "../../store/workspaceStore";
import { NoteEditor } from "../editor/NoteEditor";
import { CanvasView } from "../canvas/CanvasView";
import { LinkMap } from "../graph/LinkMap";
import { PdfViewer } from "../pdf/PdfViewer";
import { Menu, MenuItem } from "../ui/Menu";

export function Workspace() {
  const panes = useWorkspace((s) => s.panes);
  const split = !!panes[1];

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="pane-0" minSize={280}>
        <Pane index={0} item={panes[0]} split={split} />
      </Panel>
      {split && (
        <>
          <Separator className="group relative w-px bg-line outline-none data-[separator=active]:bg-accent data-[separator=hover]:bg-line-strong">
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </Separator>
          <Panel id="pane-1" minSize={280}>
            <Pane index={1} item={panes[1]} split={split} />
          </Panel>
        </>
      )}
    </Group>
  );
}

function Pane({ index, item, split }: { index: PaneIndex; item: PaneItem | null; split: boolean }) {
  const notebook = useVault((s) => s.activeNotebook);
  const focused = useWorkspace((s) => s.focused === index);
  const ws = useWorkspace.getState();

  return (
    <section className="flex h-full min-w-0 flex-col bg-bg" onMouseDownCapture={() => ws.focus(index)}>
      {item && notebook && (
        <header className="group flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className={split && focused ? "text-accent" : "text-faint"}>
            {item.kind === "note" ? (
              <FileText size={13} />
            ) : item.kind === "pdf" ? (
              <BookOpen size={13} />
            ) : item.kind === "canvas" ? (
              <Workflow size={13} />
            ) : (
              <Network size={13} />
            )}
          </span>
          <span className={`flex-1 truncate text-[12.5px] ${split && !focused ? "text-muted" : "text-ink"}`}>
            {item.kind === "pdf" ? item.name.replace(/\.pdf$/i, "") : item.name}
          </span>
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 has-[[data-open]]:opacity-100">
            <ItemMenu item={item} />
            {!split && item.kind !== "graph" && (
              <HeaderBtn title="Open a note beside" onClick={() => void openBeside(item)}>
                <Columns2 size={14} />
              </HeaderBtn>
            )}
            <HeaderBtn title="Close (Ctrl+W)" onClick={() => ws.close(index)}>
              <X size={14} />
            </HeaderBtn>
          </div>
        </header>
      )}
      <div className="relative min-h-0 flex-1">
        {!notebook ? null : item?.kind === "note" ? (
          <NoteEditor key={`note:${item.name}`} notebook={notebook} note={item.name} pane={index} target={item.target} />
        ) : item?.kind === "pdf" ? (
          <PdfViewer key={`pdf:${item.name}`} notebook={notebook} pdf={item.name} pane={index} target={item.target} />
        ) : item?.kind === "graph" ? (
          <LinkMap pane={index} />
        ) : item?.kind === "canvas" ? (
          <CanvasView key={`canvas:${item.name}`} notebook={notebook} name={item.name} pane={index} />
        ) : (
          <EmptyPane />
        )}
      </div>
    </section>
  );
}

/** Per-item actions (export etc.) behind a "…" button in the pane header. */
function ItemMenu({ item }: { item: PaneItem }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const items: (MenuItem | "divider")[] =
    item.kind === "note"
      ? [
          { label: "Export as Markdown…", icon: <Download />, onSelect: () => void exportNoteMarkdown(item.name) },
          { label: "Print / Save as PDF…", icon: <Printer />, onSelect: () => void printNote(item.name) },
          "divider",
          { label: "Insert a new canvas here", icon: <Workflow />, onSelect: () => void actions.insertCanvasIntoNote() },
        ]
      : item.kind === "pdf"
        ? [
            { label: "Collect highlights into a note", icon: <FilePlus2 />, onSelect: () => void noteFromHighlights(item.name) },
            { label: "Export highlights as Markdown…", icon: <Download />, onSelect: () => void exportHighlights(item.name) },
          ]
        : [];
  if (!items.length) return null;
  return (
    <>
      <span data-open={pos ? "" : undefined} className="contents">
        <HeaderBtn
          title="More"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPos({ x: r.right - 220, y: r.bottom + 4 });
          }}
        >
          <MoreHorizontal size={14} />
        </HeaderBtn>
      </span>
      {pos && <Menu x={pos.x} y={pos.y} items={items} onClose={() => setPos(null)} />}
    </>
  );
}

/** From a single pane, open a companion: a PDF gets a fresh note beside it; a note lets you pick something. */
async function openBeside(item: PaneItem) {
  if (item.kind === "pdf") await actions.newNote(true);
  else if (item.kind === "graph") return;
  else useUi.getState().openPalette("files", true);
}

function EmptyPane() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="animate-fade flex flex-col items-center text-center">
        <div className="mb-1 text-[15px] font-medium text-ink">Open a PDF or create a note</div>
        <div className="mb-5 text-[12.5px] text-faint">
          Press <Kbd>Ctrl</Kbd> <Kbd>P</Kbd> to find anything
        </div>
        <div className="flex gap-2">
          <EmptyBtn onClick={() => actions.newNote()} icon={<Plus size={14} />} label="New note" kbd="Ctrl N" />
          <EmptyBtn onClick={() => actions.importPdf()} icon={<Upload size={14} />} label="Import PDF" kbd="Ctrl O" />
        </div>
      </div>
    </div>
  );
}

function EmptyBtn({ onClick, icon, label, kbd }: { onClick: () => void; icon: React.ReactNode; label: string; kbd: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-line-strong"
    >
      <span className="text-muted">{icon}</span>
      {label}
      <span className="ml-1 text-[11px] text-faint">{kbd}</span>
    </button>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-line bg-surface px-1.5 py-px font-sans text-[11px] text-muted">{children}</kbd>
);

function HeaderBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}
