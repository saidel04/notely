import { Command } from "cmdk";
import {
  ArrowLeftRight,
  Bot,
  BookOpen,
  FileText,
  Download,
  FolderOpen,
  Network,
  Printer,
  Search,
  Library,
  Moon,
  PanelLeft,
  Plus,
  Sun,
  SunMoon,
  Type,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { ReactNode } from "react";
import { actions } from "../../lib/actions";
import { exportHighlights, exportNoteMarkdown, noteFromHighlights, printNote } from "../../lib/exporting";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { useWorkspace } from "../../store/workspaceStore";

export function CommandPalette() {
  const mode = useUi((s) => s.palette);
  const side = useUi((s) => s.paletteSide);
  const close = () => useUi.getState().openPalette(null);
  const notebooks = useVault((s) => s.notebooks);
  const active = useVault((s) => s.activeNotebook);
  const contents = useVault((s) => s.contents);
  const nb = notebooks.find((n) => n.name === active);

  if (mode !== "files" && mode !== "commands") return null;

  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const ws = useWorkspace.getState();
  const ui = useUi.getState();
  const current = ws.panes[ws.focused];

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/15 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <Command
        loop
        className="animate-pop w-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        onKeyDown={(e) => e.key === "Escape" && close()}
        filter={(value, search, keywords) => {
          // Title matches rank above matches in a note's body.
          const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
          const title = value.toLowerCase();
          if (terms.every((t) => title.includes(t))) return title.includes(terms.join(" ")) ? 1 : 0.8;
          const body = (keywords ?? []).join(" ").toLowerCase();
          return terms.every((t) => title.includes(t) || body.includes(t)) ? 0.3 : 0;
        }}
      >
        <Command.Input
          autoFocus
          placeholder={mode === "files" ? (side ? "Open beside…" : "Find a note or PDF…") : "Type a command…"}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[14.5px] text-ink outline-none placeholder:text-faint"
        />
        <Command.List className="max-h-[360px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-faint">Nothing found</Command.Empty>

          {mode === "files" ? (
            <>
              <Command.Group heading={active ?? "Notebook"}>
                {nb?.notes.map((n) => (
                  <Item
                    key={"n" + n.name}
                    value={"note " + n.name}
                    keywords={[(contents[n.name] ?? "").slice(0, 400)]}
                    icon={<FileText />}
                    onSelect={run(() => ws.open({ kind: "note", name: n.name }, side ? { side: true } : {}))}
                  >
                    {n.name}
                  </Item>
                ))}
                {nb?.canvases.map((c) => (
                  <Item
                    key={"c" + c.name}
                    value={"canvas " + c.name}
                    icon={<Workflow />}
                    onSelect={run(() => ws.open({ kind: "canvas", name: c.name }, side ? { side: true } : {}))}
                  >
                    {c.name}
                    <span className="ml-2 text-[11px] text-faint">Canvas</span>
                  </Item>
                ))}
                {nb?.pdfs.map((p) => (
                  <Item
                    key={"p" + p.name}
                    value={"pdf " + p.name}
                    icon={<BookOpen />}
                    onSelect={run(() => ws.open({ kind: "pdf", name: p.name }, side ? { side: true } : {}))}
                  >
                    {p.name.replace(/\.pdf$/i, "")}
                    <span className="ml-2 text-[11px] text-faint">PDF</span>
                  </Item>
                ))}
              </Command.Group>
              {!side && notebooks.length > 1 && (
                <Command.Group heading="Switch notebook">
                  {notebooks
                    .filter((n) => n.name !== active)
                    .map((n) => (
                      <Item
                        key={"b" + n.name}
                        value={"notebook " + n.name}
                        icon={<Library />}
                        onSelect={run(() => void useVault.getState().setActiveNotebook(n.name))}
                      >
                        {n.name}
                      </Item>
                    ))}
                </Command.Group>
              )}
            </>
          ) : (
            <>
              <Command.Group heading="Create">
                <Item value="New note" icon={<Plus />} hint="Ctrl N" onSelect={run(() => actions.newNote())}>
                  New note
                </Item>
                <Item value="New note beside" icon={<Plus />} onSelect={run(() => actions.newNote(true))}>
                  New note beside
                </Item>
                <Item value="New canvas diagram flowchart" icon={<Workflow />} onSelect={run(() => void actions.newCanvas())}>
                  New canvas
                </Item>
                {current?.kind === "note" && (
                  <Item value="Insert new canvas into note embed diagram" icon={<Workflow />} onSelect={run(() => void actions.insertCanvasIntoNote())}>
                    Insert a new canvas into “{current.name}”
                  </Item>
                )}
                <Item value="Import PDF" icon={<Upload />} hint="Ctrl O" onSelect={run(() => actions.importPdf())}>
                  Import PDF
                </Item>
                <Item value="New notebook" icon={<Library />} hint="Ctrl Shift N" onSelect={run(() => actions.newNotebook())}>
                  New notebook
                </Item>
              </Command.Group>
              <Command.Group heading="Explore">
                <Item value="Search notebook find text" icon={<Search />} hint="Ctrl Shift F" onSelect={run(() => actions.searchNotebook())}>
                  Search notebook
                </Item>
                <Item value="Open link map graph" icon={<Network />} hint="Ctrl G" onSelect={run(() => actions.openLinkMap())}>
                  Open link map
                </Item>
              </Command.Group>
              {current?.kind === "note" && (
                <Command.Group heading="Export">
                  <Item value="Export note as Markdown" icon={<Download />} onSelect={run(() => void exportNoteMarkdown(current.name))}>
                    Export “{current.name}” as Markdown…
                  </Item>
                  <Item value="Print save note as PDF" icon={<Printer />} onSelect={run(() => void printNote(current.name))}>
                    Print / Save “{current.name}” as PDF…
                  </Item>
                </Command.Group>
              )}
              {current?.kind === "pdf" && (
                <Command.Group heading="Export">
                  <Item value="Export highlights Markdown" icon={<Download />} onSelect={run(() => void exportHighlights(current.name))}>
                    Export highlights as Markdown…
                  </Item>
                  <Item value="Collect highlights into a note" icon={<Plus />} onSelect={run(() => void noteFromHighlights(current.name))}>
                    Collect highlights into a note
                  </Item>
                </Command.Group>
              )}
              <Command.Group heading="Layout">
                <Item value="Toggle sidebar" icon={<PanelLeft />} hint="Ctrl \" onSelect={run(() => ui.toggleSidebar())}>
                  Toggle sidebar
                </Item>
                <Item value="Swap panes" icon={<ArrowLeftRight />} onSelect={run(() => ws.swap())}>
                  Swap panes
                </Item>
                <Item value="Close pane" icon={<X />} hint="Ctrl W" onSelect={run(() => ws.close(ws.focused))}>
                  Close pane
                </Item>
              </Command.Group>
              <Command.Group heading="Appearance">
                <Item value="Theme auto system" icon={<SunMoon />} onSelect={run(() => ui.setTheme("system"))}>
                  Theme: Auto
                </Item>
                <Item value="Theme light" icon={<Sun />} onSelect={run(() => ui.setTheme("light"))}>
                  Theme: Light
                </Item>
                <Item value="Theme dark" icon={<Moon />} onSelect={run(() => ui.setTheme("dark"))}>
                  Theme: Dark
                </Item>
                <Item
                  value="Toggle note font serif sans"
                  icon={<Type />}
                  onSelect={run(() => ui.setEditorFont(ui.editorFont === "serif" ? "sans" : "serif"))}
                >
                  Note font: {ui.editorFont === "serif" ? "switch to Sans" : "switch to Serif"}
                </Item>
              </Command.Group>
              <Command.Group heading="Agents">
                <Item value="Connect an AI agent MCP Claude" icon={<Bot />} onSelect={run(() => useUi.setState({ agentPanel: true }))}>
                  Connect an AI agent…
                </Item>
              </Command.Group>
              <Command.Group heading="Vault">
                <Item value="Switch vault folder" icon={<FolderOpen />} onSelect={run(() => actions.chooseVault())}>
                  Switch vault…
                </Item>
              </Command.Group>
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function Item({
  value,
  keywords,
  icon,
  hint,
  onSelect,
  children,
}: {
  value: string;
  keywords?: string[];
  icon: ReactNode;
  hint?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-ink data-[selected=true]:bg-accent-soft"
    >
      <span className="text-muted [&>svg]:size-[15px]">{icon}</span>
      <span className="flex flex-1 items-center truncate">{children}</span>
      {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
    </Command.Item>
  );
}
