import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { CommandPalette } from "./components/palette/CommandPalette";
import { NotebookSearch } from "./components/palette/NotebookSearch";
import { AgentPanel } from "./components/shell/AgentPanel";
import { Logo } from "./components/shell/Logo";
import { TitleBar } from "./components/shell/TitleBar";
import { Welcome } from "./components/shell/Welcome";
import { Sidebar } from "./components/sidebar/Sidebar";
import { PromptDialog, Toasts } from "./components/ui/Overlays";
import { Workspace } from "./components/workspace/Workspace";
import { actions } from "./lib/actions";
import { useUi } from "./store/uiStore";
import { useVault } from "./store/vaultStore";
import { useWorkspace } from "./store/workspaceStore";

export const SIDEBAR_WIDTH = 248;

export default function App() {
  const ready = useVault((s) => s.ready);
  const vaultPath = useVault((s) => s.vaultPath);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const activeNotebook = useVault((s) => s.activeNotebook);
  const [dragging, setDragging] = useState(false);

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

  // Drag PDFs from Explorer anywhere onto the window to import them.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter") setDragging(p.paths.some((x) => x.toLowerCase().endsWith(".pdf")));
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        if (useVault.getState().activeNotebook) void actions.importPaths(p.paths);
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !useVault.getState().vaultPath) return;
      const ui = useUi.getState();
      const ws = useWorkspace.getState();
      const k = e.key.toLowerCase();
      let handled = true;
      const pdfFocused = ws.panes[ws.focused]?.kind === "pdf";
      if (k === "n" && e.shiftKey) void actions.newNotebook();
      else if (k === "f" && (e.shiftKey || !pdfFocused)) ui.openPalette(ui.palette === "search" ? null : "search");
      else if (k === "f") handled = false; // the PDF viewer handles its own Ctrl+F
      else if (k === "g") actions.openLinkMap();
      else if (k === "n") void actions.newNote();
      else if (k === "o") void actions.importPdf();
      else if (k === "p") ui.openPalette(ui.palette === "files" ? null : "files");
      else if (k === "k") ui.openPalette(ui.palette === "commands" ? null : "commands");
      else if (k === "\\") ui.toggleSidebar();
      else if (k === "w") ws.panes[ws.focused] && ws.close(ws.focused);
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

      {dragging && activeNotebook && (
        <div className="animate-fade pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent-soft p-6">
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent text-accent">
            <Upload size={28} />
            <div className="text-[15px] font-medium">Drop to import into “{activeNotebook}”</div>
          </div>
        </div>
      )}

      <CommandPalette />
      <NotebookSearch />
      <AgentPanel />
      <PromptDialog />
      <Toasts />
    </div>
  );
}
