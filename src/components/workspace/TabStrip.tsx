import { BookOpen, Columns2, FileText, Layers, Link2, Network, Workflow, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ITEM_MIME } from "../../lib/dragQuote";
import { formatLink } from "../../lib/links";
import { useUi } from "../../store/uiStore";
import { PaneIndex, PaneItem, useWorkspace } from "../../store/workspaceStore";
import { Menu } from "../ui/Menu";

export const TAB_MIME = "application/x-notely-tab";

const label = (item: PaneItem) => (item.kind === "pdf" ? item.name.replace(/\.pdf$/i, "") : item.name);

function KindIcon({ kind }: { kind: PaneItem["kind"] }) {
  const Icon =
    kind === "note" ? FileText : kind === "pdf" ? BookOpen : kind === "canvas" ? Workflow : kind === "deck" ? Layers : Network;
  return <Icon size={13} aria-hidden="true" />;
}

/**
 * The open tabs of one pane. Click to switch, middle-click or × to close,
 * drag to reorder, onto the other pane's tabs, or onto either half of the
 * workspace to snap it there; sidebar items can be dropped here to open them.
 */
export function TabStrip({ pane, focused }: { pane: PaneIndex; focused: boolean }) {
  const tabs = useWorkspace((s) => s.tabs[pane]);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  /** Where a dragged tab would land (insert before this index). */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const ws = useWorkspace.getState();

  // Keep the active tab in view when there are more than fit.
  useEffect(() => {
    strip.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs.active, tabs.items.length]);

  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_MIME) || e.dataTransfer.types.includes(ITEM_MIME);

  const drop = (e: React.DragEvent, at: number) => {
    setDropAt(null);
    const tab = e.dataTransfer.getData(TAB_MIME);
    const item = e.dataTransfer.getData(ITEM_MIME);
    if (!tab && !item) return;
    e.preventDefault();
    e.stopPropagation();
    if (tab) {
      const from = JSON.parse(tab) as { pane: PaneIndex; index: number };
      ws.moveTab(from.pane, from.index, pane, at);
    } else {
      const it = JSON.parse(item) as { kind: "note" | "pdf" | "canvas"; name: string };
      ws.open({ kind: it.kind, name: it.name }, { pane });
    }
  };

  const items = tabs.items;
  return (
    <div
      ref={strip}
      role="tablist"
      aria-label={pane === 0 ? "Left pane tabs" : "Right pane tabs"}
      className="tabstrip flex min-w-0 flex-1 items-stretch overflow-x-auto"
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        if (e.target === e.currentTarget) setDropAt(items.length);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropAt(null)}
      onDrop={(e) => drop(e, dropAt ?? items.length)}
    >
      {items.map((item, i) => {
        const active = i === tabs.active;
        return (
          <div
            key={`${item.kind}:${item.name}`}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            title={label(item)}
            draggable
            onClick={() => ws.activate(pane, i)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                ws.closeTab(pane, i);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
                ws.activate(pane, next);
                requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>("[aria-selected=true]")?.focus());
              } else if (e.key === "Delete") ws.closeTab(pane, i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, index: i });
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_MIME, JSON.stringify({ pane, index: i }));
              e.dataTransfer.effectAllowed = "copyMove";
              // Mount the snap zones now, synchronously: a native drag enters a
              // modal loop that defers setTimeout until drop, so a deferred
              // mount would never give us a drop target. Adding a sibling
              // overlay (not touching the dragged node) doesn't cancel the drag.
              useUi.setState({ tabDrag: { pane, index: i } });
            }}
            onDragEnd={() => useUi.setState({ tabDrag: null })}
            onDragOver={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDrop={(e) => drop(e, dropAt ?? i)}
            className={`group/tab relative flex max-w-[200px] min-w-[96px] shrink-0 cursor-default items-center gap-1.5 border-r border-line pr-1.5 pl-3 text-[12.5px] transition-colors select-none ${
              active ? "bg-bg text-ink" : "bg-sidebar/60 text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            {/* Insertion marker while dragging */}
            {dropAt === i && <span className="absolute inset-y-1 -left-px w-0.5 rounded bg-accent" />}
            {dropAt === items.length && i === items.length - 1 && <span className="absolute inset-y-1 -right-px w-0.5 rounded bg-accent" />}
            {active && focused && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <span className={active && focused ? "text-accent" : "text-faint"}>
              <KindIcon kind={item.kind} />
            </span>
            <span className="min-w-0 flex-1 truncate">{label(item)}</span>
            <button
              tabIndex={-1}
              aria-label={`Close ${label(item)}`}
              title="Close (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                ws.closeTab(pane, i);
              }}
              className={`flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-active hover:text-ink ${
                active ? "" : "opacity-0 group-hover/tab:opacity-100"
              }`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      {menu && items[menu.index] && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Close", icon: <X />, hint: "Ctrl W", onSelect: () => ws.closeTab(pane, menu.index) },
            { label: "Close other tabs", icon: <XCircle />, onSelect: () => ws.closeOthers(pane, menu.index) },
            "divider",
            {
              label: pane === 0 ? "Move to the right pane" : "Move to the left pane",
              icon: <Columns2 />,
              onSelect: () => ws.moveTab(pane, menu.index, pane === 0 ? 1 : 0, Number.MAX_SAFE_INTEGER),
            },
            ...(items[menu.index].kind !== "graph"
              ? [
                  {
                    label: "Copy link",
                    icon: <Link2 />,
                    onSelect: () => {
                      const it = items[menu.index];
                      void navigator.clipboard.writeText(formatLink(it.kind === "canvas" ? `${it.name}.canvas` : it.name));
                      useUi.getState().toast("Link copied");
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
