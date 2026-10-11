import {
  Columns2,
  Download,
  FilePlus2,
  GraduationCap,
  History,
  LayoutTemplate,
  ListPlus,
  ListTree,
  MoreHorizontal,
  Plus,
  Printer,
  Quote,
  Search,
  Upload,
  Workflow,
} from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { actions } from "../../lib/actions";
import { citations } from "../../lib/citeSources";
import { finders } from "../../lib/editorRegistry";
import { templates } from "../../lib/templateActions";
import { exportHighlights, exportNoteMarkdown, noteFromHighlights, printNote } from "../../lib/exporting";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { PaneIndex, PaneItem, useWorkspace } from "../../store/workspaceStore";
import { Menu, MenuItem } from "../ui/Menu";
import { TAB_MIME, TabStrip } from "./TabStrip";

// Each viewer carries a heavy dependency (CodeMirror, pdf.js, d3, the Markdown
// renderer). Loading them on demand keeps the initial bundle — and startup — small.
const NoteEditor = lazy(() => import("../editor/NoteEditor").then((m) => ({ default: m.NoteEditor })));
const PdfViewer = lazy(() => import("../pdf/PdfViewer").then((m) => ({ default: m.PdfViewer })));
const LinkMap = lazy(() => import("../graph/LinkMap").then((m) => ({ default: m.LinkMap })));
const CanvasView = lazy(() => import("../canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const DeckView = lazy(() => import("../flashcards/DeckView").then((m) => ({ default: m.DeckView })));

export function Workspace() {
  const panes = useWorkspace((s) => s.panes);
  const split = !!panes[1];

  return (
    <div className="relative h-full">
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
      <SnapZones />
    </div>
  );
}

/**
 * While a tab is dragged, the area below the tab bars becomes two drop zones:
 * drop on the left or right to snap the tab to that side (splitting the view
 * if needed). The tab bars stay uncovered so tabs can still be reordered.
 *
 * The overlay is always mounted (just inert when idle): a native drag runs a
 * modal loop that both defers timers and cancels the drag if the source's DOM
 * changes, so we must neither mount this on drag-start nor depend on a timer —
 * only its `pointer-events` toggle, driven by the synchronously-set `tabDrag`.
 */
function SnapZones() {
  const drag = useUi((s) => s.tabDrag);
  const tabs = useWorkspace((s) => s.tabs);
  const [side, setSide] = useState<PaneIndex | null>(null);
  const host = useRef<HTMLDivElement>(null);
  if (!drag) return <div data-snap-zones className="pointer-events-none absolute inset-x-0 top-9 bottom-0 z-30" />;

  const split = tabs[1].items.length > 0;
  // Snapping does something only if the tab would end up somewhere new.
  const useful = (s: PaneIndex) => (split ? s !== drag.pane : tabs[0].items.length > 1);
  const sideAt = (clientX: number): PaneIndex => {
    const right = document.querySelector<HTMLElement>('[data-pane="1"]');
    if (split && right) return clientX >= right.getBoundingClientRect().left ? 1 : 0;
    const r = host.current!.getBoundingClientRect();
    return clientX >= r.left + r.width / 2 ? 1 : 0;
  };
  // Where the tab would go: the pane it joins, or the half it would take.
  const preview = (() => {
    if (side === null || !useful(side) || !host.current) return null;
    const box = host.current.getBoundingClientRect();
    const right = document.querySelector<HTMLElement>('[data-pane="1"]')?.getBoundingClientRect();
    if (split && right) {
      return side === 1 ? { left: right.left - box.left, width: box.right - right.left } : { left: 0, width: right.left - box.left };
    }
    return side === 1 ? { left: box.width / 2, width: box.width / 2 } : { left: 0, width: box.width / 2 };
  })();

  return (
    <div
      ref={host}
      data-snap-zones
      className="absolute inset-x-0 top-9 bottom-0 z-30"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return;
        const s = sideAt(e.clientX);
        if (s !== side) setSide(s);
        if (!useful(s)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setSide(null)}
      onDrop={(e) => {
        e.preventDefault();
        const s = sideAt(e.clientX);
        setSide(null);
        useUi.setState({ tabDrag: null });
        if (useful(s)) useWorkspace.getState().snap(drag.pane, drag.index, s);
      }}
    >
      {preview && (
        <div
          className="pointer-events-none absolute inset-y-2 flex items-center justify-center rounded-lg border-2 border-accent/60 bg-accent-soft/70 text-[12.5px] font-medium text-accent transition-all duration-150"
          style={{ left: preview.left + 8, width: preview.width - 16 }}
        >
          {side === 0 ? "Snap to the left" : "Snap to the right"}
        </div>
      )}
    </div>
  );
}

function Pane({ index, item, split }: { index: PaneIndex; item: PaneItem | null; split: boolean }) {
  const notebook = useVault((s) => s.activeNotebook);
  const focused = useWorkspace((s) => s.focused === index);
  const outlineOpen = useUi((s) => s.outlineOpen);
  const ws = useWorkspace.getState();

  return (
    <section data-pane={index} className="flex h-full min-w-0 flex-col bg-bg" onMouseDownCapture={() => ws.focus(index)}>
      {item && notebook && (
        <header className="group flex h-9 shrink-0 items-stretch border-b border-line bg-sidebar/60">
          <TabStrip pane={index} focused={focused && split} />
          <div className="flex shrink-0 items-center px-1.5 opacity-0 transition-opacity group-hover:opacity-100 has-[[data-open]]:opacity-100">
            {item.kind === "note" && (
              <HeaderBtn title={outlineOpen ? "Hide outline (Ctrl+Shift+O)" : "Show outline (Ctrl+Shift+O)"} onClick={() => useUi.getState().toggleOutline()}>
                <ListTree size={14} />
              </HeaderBtn>
            )}
            <ItemMenu item={item} pane={index} />
            {!split && item.kind !== "graph" && (
              <HeaderBtn title="Open a note beside" onClick={() => void openBeside(item)}>
                <Columns2 size={14} />
              </HeaderBtn>
            )}
          </div>
        </header>
      )}
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<div className="h-full bg-bg" />}>
          {!notebook ? null : item?.kind === "note" ? (
            <NoteEditor key={`note:${item.name}`} notebook={notebook} note={item.name} pane={index} target={item.target} />
          ) : item?.kind === "pdf" ? (
            <PdfViewer key={`pdf:${item.name}`} notebook={notebook} pdf={item.name} pane={index} target={item.target} />
          ) : item?.kind === "graph" ? (
            <LinkMap pane={index} />
          ) : item?.kind === "canvas" ? (
            <CanvasView key={`canvas:${item.name}`} notebook={notebook} name={item.name} pane={index} />
          ) : item?.kind === "deck" ? (
            <DeckView key={`deck:${item.name}`} notebook={notebook} name={item.name} />
          ) : (
            <EmptyPane />
          )}
        </Suspense>
      </div>
    </section>
  );
}

/** Per-item actions (export etc.) behind a "…" button in the pane header. */
function ItemMenu({ item, pane }: { item: PaneItem; pane: PaneIndex }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const items: (MenuItem | "divider")[] =
    item.kind === "note"
      ? [
          { label: "Find in note", icon: <Search />, hint: "Ctrl F", onSelect: () => finders.get(pane)?.() },
          "divider",
          { label: "Copy references (APA)", icon: <Quote />, onSelect: () => void citations.copyApa(item.name) },
          { label: "Copy citations (BibTeX)", icon: <Quote />, onSelect: () => void citations.copyBibtex(item.name) },
          { label: "Export citations as .bib…", icon: <Download />, onSelect: () => void citations.exportBib(item.name) },
          { label: "Add a References section", icon: <ListPlus />, onSelect: () => void citations.insertReferences(item.name, pane) },
          "divider",
          { label: "Version history…", icon: <History />, onSelect: () => useUi.setState({ history: { note: item.name } }) },
          { label: "Save as template…", icon: <LayoutTemplate />, onSelect: () => void templates.saveNote(item.name) },
          { label: "Export as Markdown…", icon: <Download />, onSelect: () => void exportNoteMarkdown(item.name) },
          { label: "Print / Save as PDF…", icon: <Printer />, onSelect: () => void printNote(item.name) },
          "divider",
          { label: "Insert a new canvas here", icon: <Workflow />, onSelect: () => void actions.insertCanvasIntoNote() },
        ]
      : item.kind === "deck"
        ? [
            { label: "Review this deck", icon: <GraduationCap />, onSelect: () => actions.review(item.name) },
            { label: "Review every deck", icon: <GraduationCap />, onSelect: () => actions.review() },
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
