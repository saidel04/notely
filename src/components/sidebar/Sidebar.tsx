import { confirm } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Columns2,
  FileText,
  FolderOpen,
  GraduationCap,
  Hash,
  Layers,
  LayoutTemplate,
  Link2,
  Merge,
  Moon,
  Network,
  Pencil,
  RefreshCw,
  Plus,
  Search,
  Settings2,
  Sun,
  SunMoon,
  Trash2,
  Type,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { actions } from "../../lib/actions";
import { ITEM_MIME } from "../../lib/dragQuote";
import { formatLink, sameName } from "../../lib/links";
import { validateTag } from "../../lib/tags";
import { templates } from "../../lib/templateActions";
import { checkForUpdates } from "../../lib/updates";
import { useDeckCards, useDueCount } from "../../store/deck";
import { useHighlights } from "../../store/highlightStore";
import { useTagged, useTagIndex } from "../../store/tagIndex";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { PaneItem, useWorkspace } from "../../store/workspaceStore";
import { Floating, Menu, useMenu } from "../ui/Menu";

export function Sidebar() {
  const activeNotebook = useVault((s) => s.activeNotebook);
  const notebook = useVault((s) => s.notebooks.find((n) => n.name === s.activeNotebook));
  const panes = useWorkspace((s) => s.panes);
  const focused = useWorkspace((s) => s.focused);
  const [renaming, setRenaming] = useState<PaneItem | null>(null);
  const menu = useMenu<PaneItem>();
  const tagFilter = useUi((s) => s.tagFilter);
  const tagged = useTagged(tagFilter);
  const notes = notebook?.notes.filter((n) => !tagged || tagged.notes.has(n.name)) ?? [];
  const canvases = notebook?.canvases.filter((c) => !tagged || tagged.canvases.has(c.name)) ?? [];
  const decks = notebook?.decks ?? [];

  const isOpen = (kind: PaneItem["kind"], name: string) =>
    panes.some((p) => p?.kind === kind && sameName(p.name, name));
  const isFocused = (kind: PaneItem["kind"], name: string) => {
    const p = panes[focused];
    return p?.kind === kind && sameName(p.name, name);
  };

  const openItem = (item: PaneItem, side: boolean) => useWorkspace.getState().open(item, side ? { side: true } : {});

  const commitRename = async (item: PaneItem, next: string) => {
    setRenaming(null);
    const v = useVault.getState();
    if (item.kind === "note") await v.renameNote(item.name, next);
    else if (item.kind === "canvas") await v.renameCanvas(item.name, next);
    else if (item.kind === "deck") await v.renameDeck(item.name, next);
    else {
      useHighlights.getState().forget(activeNotebook!, item.name);
      await v.renamePdf(item.name, next);
    }
  };

  const remove = (item: PaneItem) => {
    const v = useVault.getState();
    if (item.kind === "note") void v.deleteNote(item.name);
    else if (item.kind === "canvas") void v.deleteCanvas(item.name);
    else if (item.kind === "deck") void v.deleteDeck(item.name);
    else {
      useHighlights.getState().forget(activeNotebook!, item.name);
      void v.deletePdf(item.name);
    }
    useUi.getState().toast(`Moved “${item.name}” to the Recycle Bin`);
  };

  // Up/Down (and Home/End) move focus between the item rows — a roving-focus list.
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-sb-item]")];
    if (!rows.length) return;
    const here = rows.indexOf(document.activeElement as HTMLElement);
    let next = here;
    if (e.key === "ArrowDown") next = here < 0 ? 0 : Math.min(rows.length - 1, here + 1);
    else if (e.key === "ArrowUp") next = here < 0 ? rows.length - 1 : Math.max(0, here - 1);
    else if (e.key === "Home") next = 0;
    else next = rows.length - 1;
    e.preventDefault();
    rows[next]?.focus();
  };

  return (
    <aside className="flex h-full flex-col bg-sidebar" aria-label="Notebook contents">
      <NotebookSwitcher />

      <div className="px-2 pb-3">
        <ToolRow icon={<Search size={14} />} label="Search" hint="Ctrl ⇧ F" onClick={() => actions.searchNotebook()} />
        <ToolRow
          icon={<Network size={14} />}
          label="Link map"
          hint="Ctrl G"
          active={panes.some((p) => p?.kind === "graph")}
          onClick={() => actions.openLinkMap()}
        />
        <ToolRow icon={<CalendarDays size={14} />} label="Today" hint="Ctrl ⇧ D" onClick={() => void templates.today()} />
        <ReviewRow />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4" onKeyDown={onListKeyDown}>
        {tagFilter && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[12.5px]">
            <Hash size={13} className="text-accent" />
            <span className="flex-1 truncate font-medium text-accent">{tagFilter}</span>
            <span className="text-[11.5px] text-muted">{notes.length + canvases.length}</span>
            <button title="Clear filter" aria-label="Clear tag filter" onClick={() => useUi.setState({ tagFilter: null })} className="rounded p-0.5 text-muted hover:text-ink">
              <X size={13} />
            </button>
          </div>
        )}
        <Section
          title="Notes"
          action={{ title: "New note (Ctrl+N)", icon: <Plus size={14} />, onClick: () => actions.newNote() }}
          extra={{ title: "New note from template", icon: <LayoutTemplate size={13} />, onClick: () => useUi.getState().openPalette("templates") }}
        >
          {notes.length === 0 && <Hint>{tagFilter ? "No notes with this tag" : "No notes yet"}</Hint>}
          {notes.map((n) => {
            const item: PaneItem = { kind: "note", name: n.name };
            return (
              <Row
                key={n.name}
                icon={<FileText size={14} />}
                label={n.name}
                drag={item}
                open={isOpen("note", n.name)}
                focused={isFocused("note", n.name)}
                renaming={renaming?.kind === "note" && renaming.name === n.name}
                onRename={(v) => commitRename(item, v)}
                onCancelRename={() => setRenaming(null)}
                onClick={(e) => openItem(item, e.ctrlKey)}
                onContextMenu={(e) => menu.open(e, item)}
              />
            );
          })}
        </Section>

        {!tagFilter && (
        <Section title="PDFs" action={{ title: "Import PDF (Ctrl+O)", icon: <Upload size={13} />, onClick: () => actions.importPdf() }}>
          {notebook?.pdfs.length === 0 && <Hint>Drop PDFs here to import</Hint>}
          {notebook?.pdfs.map((p) => {
            const item: PaneItem = { kind: "pdf", name: p.name };
            return (
              <Row
                key={p.name}
                icon={<BookOpen size={14} />}
                label={p.name.replace(/\.pdf$/i, "")}
                drag={item}
                renameValue={p.name.replace(/\.pdf$/i, "")}
                open={isOpen("pdf", p.name)}
                focused={isFocused("pdf", p.name)}
                renaming={renaming?.kind === "pdf" && renaming.name === p.name}
                onRename={(v) => commitRename(item, v)}
                onCancelRename={() => setRenaming(null)}
                onClick={(e) => openItem(item, e.ctrlKey)}
                onContextMenu={(e) => menu.open(e, item)}
              />
            );
          })}
        </Section>
        )}

        <Section title="Canvases" action={{ title: "New canvas", icon: <Plus size={14} />, onClick: () => actions.newCanvas() }}>
          {canvases.length === 0 && <Hint>{tagFilter ? "No canvases with this tag" : "Draw diagrams and flowcharts"}</Hint>}
          {canvases.map((c) => {
            const item: PaneItem = { kind: "canvas", name: c.name };
            return (
              <Row
                key={c.name}
                icon={<Workflow size={14} />}
                label={c.name}
                drag={item}
                open={isOpen("canvas", c.name)}
                focused={isFocused("canvas", c.name)}
                renaming={renaming?.kind === "canvas" && renaming.name === c.name}
                onRename={(v) => commitRename(item, v)}
                onCancelRename={() => setRenaming(null)}
                onClick={(e) => openItem(item, e.ctrlKey)}
                onContextMenu={(e) => menu.open(e, item)}
              />
            );
          })}
        </Section>

        {!tagFilter && (
          <Section title="Flashcards" action={{ title: "New flashcard deck", icon: <Plus size={14} />, onClick: () => void actions.newDeck() }}>
            {decks.length === 0 && <Hint>One card per line: “Question: answer”</Hint>}
            {decks.map((d) => {
              const item: PaneItem = { kind: "deck", name: d.name };
              return (
                <DeckRow
                  key={d.name}
                  name={d.name}
                  open={isOpen("deck", d.name)}
                  focused={isFocused("deck", d.name)}
                  renaming={renaming?.kind === "deck" && renaming.name === d.name}
                  onRename={(v) => commitRename(item, v)}
                  onCancelRename={() => setRenaming(null)}
                  onClick={(e) => openItem(item, e.ctrlKey)}
                  onContextMenu={(e) => menu.open(e, item)}
                />
              );
            })}
          </Section>
        )}

        <TagsSection active={tagFilter} />
      </div>

      <SettingsButton />

      {menu.state && (
        <Menu
          x={menu.state.x}
          y={menu.state.y}
          onClose={menu.close}
          items={[
            { label: "Open", icon: <FileText />, onSelect: () => openItem(menu.state!.data, false) },
            { label: "Open to the side", icon: <Columns2 />, hint: "Ctrl+click", onSelect: () => openItem(menu.state!.data, true) },
            // Decks aren't link targets; reviewing them is what you'd want here instead.
            ...(menu.state.data.kind === "deck"
              ? [{ label: "Review this deck", icon: <GraduationCap />, onSelect: () => actions.review(menu.state!.data.name) }]
              : [
                  {
                    label: "Copy link",
                    icon: <Link2 />,
                    onSelect: () => {
                      const it = menu.state!.data;
                      void navigator.clipboard.writeText(formatLink(it.kind === "canvas" ? `${it.name}.canvas` : it.name));
                      useUi.getState().toast("Link copied — select words in a note and paste to link them");
                    },
                  },
                ]),
            "divider",
            { label: "Rename", icon: <Pencil />, onSelect: () => setRenaming(menu.state!.data) },
            { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => remove(menu.state!.data) },
          ]}
        />
      )}
    </aside>
  );
}

function NotebookSwitcher() {
  const notebooks = useVault((s) => s.notebooks);
  const active = useVault((s) => s.activeNotebook);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const menu = useMenu<string>();

  const remove = async (name: string) => {
    const ok = await confirm(`Move the notebook “${name}” and everything in it to the Recycle Bin?`, {
      title: "Delete notebook",
      kind: "warning",
      okLabel: "Delete",
    });
    if (ok) await useVault.getState().deleteNotebook(name);
  };

  return (
    <div className="px-2 pt-1 pb-3">
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos(pos ? null : { x: r.left, y: r.bottom + 4 });
        }}
        aria-label={`Current notebook: ${active ?? "none"}. Switch notebook`}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-accent text-[11px] font-semibold text-white">
          {(active ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">{active ?? "No notebook"}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>

      {pos && (
        <Floating x={pos.x} y={pos.y} onClose={() => setPos(null)} className="w-[236px] p-1">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Notebooks</div>
          <div className="max-h-[50vh] overflow-y-auto">
            {notebooks.map((nb) => (
              <button
                key={nb.name}
                onClick={() => {
                  setPos(null);
                  void useVault.getState().setActiveNotebook(nb.name);
                }}
                onContextMenu={(e) => menu.open(e, nb.name)}
                className="group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-hover"
              >
                <span className="flex-1 truncate">{nb.name}</span>
                <span className="text-[11.5px] text-faint group-hover:hidden">{nb.notes.length + nb.pdfs.length || ""}</span>
                {nb.name === active && <Check size={14} className="text-accent group-hover:hidden" />}
                <span
                  role="button"
                  title="More"
                  onClick={(e) => (e.stopPropagation(), menu.open(e, nb.name))}
                  className="hidden rounded px-1 text-faint group-hover:block hover:text-ink"
                >
                  ···
                </span>
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            onClick={() => (setPos(null), actions.newNotebook())}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-ink"
          >
            <Plus size={14} /> New notebook
          </button>
        </Floating>
      )}

      {menu.state && (
        <Menu
          x={menu.state.x}
          y={menu.state.y}
          onClose={menu.close}
          items={[
            { label: "Rename", icon: <Pencil />, onSelect: () => (setPos(null), actions.renameNotebook(menu.state!.data)) },
            { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => (setPos(null), remove(menu.state!.data)) },
          ]}
        />
      )}
    </div>
  );
}

function ToolRow({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] hover:bg-hover hover:text-ink ${
        active ? "text-ink" : "text-muted"
      }`}
    >
      <span className={active ? "text-accent" : "text-faint"}>{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[11px] text-faint opacity-0 group-hover:opacity-100">{hint}</span>
    </button>
  );
}

/** Flashcard review, with how many cards are waiting across the notebook's decks. */
function ReviewRow() {
  const due = useDueCount();
  return (
    <button
      onClick={() => actions.review()}
      aria-label={due ? `Review flashcards, ${due} waiting` : "Review flashcards"}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] text-muted hover:bg-hover hover:text-ink"
    >
      <span className="text-faint" aria-hidden="true">
        <GraduationCap size={14} />
      </span>
      <span className="flex-1">Review</span>
      {due > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium text-accent tabular-nums">{due}</span>}
    </button>
  );
}

function TagsSection({ active }: { active: string | null }) {
  const tags = useTagIndex();
  const [showAll, setShowAll] = useState(false);
  const menu = useMenu<string>();
  if (!tags.length) return null;

  const rename = async (tag: string) => {
    const next = await useUi.getState().ask({
      title: `Rename #${tag} in every notebook`,
      initial: tag,
      placeholder: "New tag name",
      confirmLabel: "Rename",
      validate: validateTag,
    });
    if (next) await useVault.getState().renameTag(tag, next);
  };
  const merge = async (tag: string) => {
    const others = tags.filter((t) => t.key !== tag.toLowerCase()).map((t) => t.name);
    const into = await useUi.getState().ask({
      title: `Merge #${tag} into…`,
      placeholder: others.slice(0, 3).map((t) => `#${t}`).join(", ") || "Another tag",
      confirmLabel: "Merge",
      validate: (v) =>
        validateTag(v) ??
        (others.some((t) => t.toLowerCase() === v.trim().replace(/^#/, "").toLowerCase()) ? null : "Pick a tag that's already in use"),
    });
    if (into) await useVault.getState().renameTag(tag, into);
  };
  const shown = showAll ? tags : tags.slice(0, 12);
  return (
    <div className="mb-4">
      <div className="flex h-7 items-center px-2">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Tags</span>
      </div>
      <div className="flex flex-wrap gap-1 px-1.5">
        {shown.map((t) => {
          const on = !!active && t.key === active.toLowerCase();
          return (
            <button
              key={t.key}
              onClick={() => useUi.setState({ tagFilter: on ? null : t.name })}
              onContextMenu={(e) => menu.open(e, t.name)}
              title={`${t.notes.length} note(s), ${t.canvases.length} canvas(es) — right-click to rename or merge`}
              className={`rounded-full px-2 py-0.5 text-[12px] transition-colors ${on ? "bg-accent text-white" : "bg-hover text-muted hover:text-ink"}`}
            >
              #{t.name}
              <span className={`ml-1 text-[10.5px] ${on ? "text-white/75" : "text-faint"}`}>{t.notes.length + t.canvases.length}</span>
            </button>
          );
        })}
        {tags.length > 12 && (
          <button onClick={() => setShowAll(!showAll)} className="px-1.5 text-[11.5px] text-faint hover:text-ink">
            {showAll ? "Less" : `+${tags.length - 12} more`}
          </button>
        )}
      </div>
      {menu.state && (
        <Menu
          x={menu.state.x}
          y={menu.state.y}
          onClose={menu.close}
          items={[
            { label: "Show notes with this tag", icon: <Hash />, onSelect: () => useUi.setState({ tagFilter: menu.state!.data }) },
            "divider",
            { label: "Rename tag…", icon: <Pencil />, onSelect: () => void rename(menu.state!.data) },
            ...(tags.length > 1 ? [{ label: "Merge into another tag…", icon: <Merge />, onSelect: () => void merge(menu.state!.data) }] : []),
          ]}
        />
      )}
    </div>
  );
}

interface SectionAction {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function Section({
  title,
  action,
  extra,
  children,
}: {
  title: string;
  action: SectionAction;
  /** Another action shown before the main one. */
  extra?: SectionAction;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="group flex h-7 items-center justify-between px-2">
        <span className="flex-1 text-[11px] font-medium tracking-wide text-faint uppercase">{title}</span>
        {[extra, action].filter((a): a is SectionAction => !!a).map((a) => (
          <button
            key={a.title}
            onClick={a.onClick}
            title={a.title}
            aria-label={a.title}
            className="flex size-6 items-center justify-center rounded-md text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-ink"
          >
            {a.icon}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2 py-1 text-[12.5px] text-faint">{children}</div>
);

function Row({
  icon,
  label,
  count,
  renameValue,
  open,
  focused,
  renaming,
  onRename,
  onCancelRename,
  onClick,
  onContextMenu,
  drag,
}: {
  icon: React.ReactNode;
  label: string;
  /** A number shown at the end of the row (a deck's card count). */
  count?: number;
  drag?: PaneItem;
  renameValue?: string;
  open: boolean;
  focused: boolean;
  renaming: boolean;
  onRename: (v: string) => void;
  onCancelRename: () => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (renaming) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-active px-2 py-[3px]">
        <span className="text-faint">{icon}</span>
        <input
          ref={inputRef}
          autoFocus
          defaultValue={renameValue ?? label}
          spellCheck={false}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onCancelRename();
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
        />
      </div>
    );
  }

  const kindWord = drag?.kind === "pdf" ? "PDF" : drag?.kind === "canvas" ? "canvas" : drag ? "note" : "deck";
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={label}
      data-sb-item
      aria-label={`${kindWord}: ${label}`}
      aria-current={focused ? "true" : undefined}
      draggable={!!drag}
      onDragStart={(e) => {
        if (!drag) return;
        // Dropped onto a canvas, this becomes a card.
        e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ kind: drag.kind, name: drag.name }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors ${
        focused ? "bg-active text-ink" : open ? "text-ink hover:bg-hover" : "text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      <span className={focused ? "text-accent" : "text-faint"} aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="shrink-0 text-[11px] text-faint tabular-nums">{count}</span>}
    </button>
  );
}

/** A deck row: the same as any item row, with how many cards it holds. */
function DeckRow(props: Omit<Parameters<typeof Row>[0], "icon" | "label" | "drag"> & { name: string }) {
  const { cards } = useDeckCards(props.name);
  return (
    <Row
      {...props}
      icon={<Layers size={14} />}
      label={props.name}
      count={cards.length || undefined}
    />
  );
}

function SettingsButton() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const { theme, setTheme, editorFont, setEditorFont } = useUi();
  const vaultPath = useVault((s) => s.vaultPath);

  return (
    <div className="border-t border-line px-2 py-2">
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: r.left, y: r.top });
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-muted hover:bg-hover hover:text-ink"
      >
        <Settings2 size={14} />
        Settings
      </button>
      {pos && (
        <Menu
          x={pos.x}
          y={pos.y}
          placement="above"
          onClose={() => setPos(null)}
          header={
            <div className="px-2.5 pt-2 pb-2">
              <div className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">Appearance</div>
              <Segmented
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "system", label: "Auto", icon: <SunMoon size={13} /> },
                  { value: "light", label: "Light", icon: <Sun size={13} /> },
                  { value: "dark", label: "Dark", icon: <Moon size={13} /> },
                ]}
              />
              <div className="mt-3 mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">Note font</div>
              <Segmented
                value={editorFont}
                onChange={setEditorFont}
                options={[
                  { value: "serif", label: "Serif", icon: <Type size={13} /> },
                  { value: "sans", label: "Sans", icon: <Type size={13} /> },
                ]}
              />
              <div className="mt-3 truncate text-[11.5px] text-faint" title={vaultPath ?? ""}>
                Vault: {vaultPath}
              </div>
            </div>
          }
          items={[
            "divider",
            { label: "Open vault folder", icon: <FolderOpen />, onSelect: () => vaultPath && void openPath(vaultPath) },
            { label: "Switch vault…", icon: <BookOpen />, onSelect: () => actions.chooseVault() },
            "divider",
            { label: "Connect an AI agent…", icon: <Bot />, onSelect: () => useUi.setState({ agentPanel: true }) },
            "divider",
            { label: "Check for updates…", icon: <RefreshCw />, onSelect: () => void checkForUpdates() },
          ]}
        />
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: React.ReactNode }[];
}) {
  return (
    <div className="flex rounded-md bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] py-1 text-[12px] ${
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
