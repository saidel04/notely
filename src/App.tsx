import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ImagePlus, Upload } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

// cmdk and the PDF text search engine load on the first palette open, not at startup.
const Palettes = lazy(() => import("./components/palette/Palettes"));
const ReviewPanel = lazy(() => import("./components/review/ReviewPanel"));
const HistoryPanel = lazy(() => import("./components/editor/HistoryPanel"));
import { AgentPanel } from "./components/shell/AgentPanel";
import { Logo } from "./components/shell/Logo";
import { TitleBar } from "./components/shell/TitleBar";
import { Welcome } from "./components/shell/Welcome";
import { Sidebar } from "./components/sidebar/Sidebar";
import { PromptDialog, Toasts } from "./components/ui/Overlays";
import { Workspace } from "./components/workspace/Workspace";
import { actions } from "./lib/actions";
import { finders } from "./lib/editorRegistry";
import { isImagePath } from "./lib/images";
import { templates } from "./lib/templateActions";
import { useUi } from "./store/uiStore";
import { useVault } from "./store/vaultStore";
import { useWorkspace } from "./store/workspaceStore";

export const SIDEBAR_WIDTH = 248;

export default function App() {
  const ready = useVault((s) => s.ready);
  const vaultPath = useVault((s) => s.vaultPath);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const paletteOpen = useUi((s) => s.palette !== null);
  const reviewOpen = useUi((s) => s.review !== null);
  const historyOpen = useUi((s) => s.history !== null);
  const activeNotebook = useVault((s) => s.activeNotebook);
  /** What a file drag over the window would do, for the drop hint. */
  const [dragging, setDragging] = useState<null | "pdf" | "image">(null);

  // Reflect edits made outside the app (Explorer, other editors, sync tools).
  useEffect(() => {
    let timer = 0;
    const un = listen<string[]>("vault-changed", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await useVault.getState().refresh();
        await useVault.getState().reloadContents(true);
      }, 250);
    });
    return () => void un.then((f) => f());
  }, []);

  // Drag files from Explorer onto the window: PDFs are imported, images go into a note.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter") {
        setDragging(
          p.paths.some((x) => x.toLowerCase().endsWith(".pdf")) ? "pdf" : p.paths.some(isImagePath) ? "image" : null,
        );
      } else if (p.type === "leave") setDragging(null);
      else if (p.type === "drop") {
        setDragging(null);
        if (!useVault.getState().activeNotebook) return;
        const scale = window.devicePixelRatio || 1;
        void actions.dropFiles(p.paths, { x: p.position.x / scale, y: p.position.y / scale });
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Already handled by whatever has focus (e.g. the editor's own Ctrl+F).
      if (e.defaultPrevented) return;
      if (!(e.ctrlKey || e.metaKey) || !useVault.getState().vaultPath) return;
      const ui = useUi.getState();
      const ws = useWorkspace.getState();
      const k = e.key.toLowerCase();
      let handled = true;
      const focusedKind = ws.panes[ws.focused]?.kind;
      const findInNote = focusedKind === "note" ? finders.get(ws.focused) : undefined;
      if (k === "n" && e.shiftKey) void actions.newNotebook();
      else if (k === "d" && e.shiftKey) void templates.today();
      else if (k === "f" && e.shiftKey) ui.openPalette(ui.palette === "search" ? null : "search");
      else if (k === "f" && findInNote) findInNote();
      else if (k === "f" && focusedKind === "pdf") handled = false; // the PDF viewer handles its own Ctrl+F
      else if (k === "f") ui.openPalette(ui.palette === "search" ? null : "search");
      else if (k === "g") actions.openLinkMap();
      else if (k === "n") void actions.newNote();
      else if (k === "o" && e.shiftKey) ui.toggleOutline();
      else if (k === "o") void actions.importPdf();
      else if (k === "p") ui.openPalette(ui.palette === "files" ? null : "files");
      else if (k === "k") ui.openPalette(ui.palette === "commands" ? null : "commands");
      else if (k === "\\") ui.toggleSidebar();
      else if (k === "w") ws.panes[ws.focused] && ws.close(ws.focused);
      else if (k === "tab") ws.cycle(e.shiftKey ? -1 : 1);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="h-full bg-bg" />;

  return (
    <div className="flex h-full flex-col bg-bg">
      {!vaultPath ? (
        <>
          <TitleBar />
          <div className="min-h-0 flex-1">
            <Welcome />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <div className="flex shrink-0 flex-col border-r border-line bg-sidebar" style={{ width: SIDEBAR_WIDTH }}>
              <div data-tauri-drag-region className="flex h-[38px] shrink-0 items-center gap-2 px-4 text-[12.5px] font-semibold tracking-tight text-muted">
                <Logo size={16} />
                Notely
              </div>
              <div className="min-h-0 flex-1">
                <Sidebar />
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <TitleBar />
            <div className="min-h-0 flex-1">{activeNotebook && <Workspace />}</div>
          </div>
        </div>
      )}

      {dragging === "pdf" && activeNotebook && (
        <div className="animate-fade pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent-soft p-6">
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent text-accent">
            <Upload size={28} />
            <div className="text-[15px] font-medium">Drop to import into “{activeNotebook}”</div>
          </div>
        </div>
      )}
      {dragging === "image" && activeNotebook && (
        // Light hint only: the image lands where it's dropped, so keep the note visible.
        <div className="animate-pop pointer-events-none fixed top-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent bg-surface px-4 py-2 text-[12.5px] font-medium text-accent shadow-pop">
          <ImagePlus size={15} /> Drop onto a note to add the image
        </div>
      )}

      {paletteOpen && (
        <Suspense fallback={null}>
          <Palettes />
        </Suspense>
      )}
      {historyOpen && activeNotebook && (
        <Suspense fallback={null}>
          <HistoryPanel />
        </Suspense>
      )}
      {reviewOpen && activeNotebook && (
        <Suspense fallback={null}>
          <ReviewPanel />
        </Suspense>
      )}
      <AgentPanel />
      <PromptDialog />
      <Toasts />
    </div>
  );
}
