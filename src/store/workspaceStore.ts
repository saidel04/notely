import { create } from "zustand";
import { sameName } from "../lib/links";
import { setSettingSoon, settings } from "../lib/settings";

export interface PdfTarget {
  page?: number;
  highlightId?: string;
  bookmarkId?: string;
  /** Opens the in-PDF search with this query, jumping to its first match on `page`. */
  search?: string;
  /** Changes on every navigation so re-clicking the same link scrolls again. */
  nonce: number;
}

/** A character range to select and scroll to in a note. */
export interface NoteTarget {
  from: number;
  to: number;
  nonce: number;
}

export const GRAPH_NAME = "Link map";

export type PaneItem =
  | { kind: "note"; name: string; target?: NoteTarget }
  | { kind: "pdf"; name: string; target?: PdfTarget }
  | { kind: "graph"; name: string }
  | { kind: "canvas"; name: string }
  | { kind: "deck"; name: string };

export type PaneIndex = 0 | 1;

/** The tabs open in one pane. */
export interface PaneTabs {
  items: PaneItem[];
  active: number;
}

interface Layout {
  tabs: [PaneTabs, PaneTabs];
  focused: PaneIndex;
}

interface WorkspaceStore extends Layout {
  notebook: string | null;
  /** The item showing in each pane (its active tab) — what most of the app reads. */
  panes: [PaneItem | null, PaneItem | null];

  loadLayout(notebook: string | null): Promise<void>;
  focus(pane: PaneIndex): void;
  /**
   * Opens an item as a tab: switches to it if it's already open, otherwise adds
   * it to the focused pane (or `pane`, or the other pane with `side`).
   */
  open(item: PaneItem, opts?: { pane?: PaneIndex; side?: boolean }): void;
  /** Closes the pane's current tab. */
  close(pane: PaneIndex): void;
  closeTab(pane: PaneIndex, index: number): void;
  /** Closes every tab in the pane except `index`. */
  closeOthers(pane: PaneIndex, index: number): void;
  activate(pane: PaneIndex, index: number): void;
  /** Moves a tab within its pane or to the other one. */
  moveTab(from: PaneIndex, index: number, to: PaneIndex, toIndex: number): void;
  /**
   * Drops a dragged tab onto the left or right half of the workspace: it moves
   * to that pane, splitting the view when there's only one.
   */
  snap(from: PaneIndex, index: number, side: PaneIndex): void;
  /** Ctrl+Tab: the next (or previous) tab in the focused pane. */
  cycle(dir: 1 | -1): void;
  renameItem(kind: PaneItem["kind"], old: string, next: string): void;
  removeItem(kind: PaneItem["kind"], name: string): void;
  swap(): void;
  /** Replaces everything with one tab per pane. */
  setLayout(panes: [PaneItem | null, PaneItem | null], focused: PaneIndex): void;
}

/** Older tabs are dropped beyond this, so following links never piles up endlessly. */
export const MAX_TABS = 12;

const other = (p: PaneIndex): PaneIndex => (p === 0 ? 1 : 0);
const same = (a: PaneItem | null | undefined, kind: PaneItem["kind"], name: string) =>
  !!a && a.kind === kind && sameName(a.name, name);

/** Notes just created from the UI; their editor focuses the title for naming. */
export const freshNotes = new Set<string>();

let nonce = 0;
export const nextNonce = () => ++nonce;

const noTabs = (): PaneTabs => ({ items: [], active: 0 });
const EMPTY: Layout = { tabs: [noTabs(), noTabs()], focused: 0 };

const current = (t: PaneTabs) => t.items[t.active] ?? null;

/**
 * Keeps the layout consistent: active indexes in range, and a lone pane is
 * always the left one.
 */
export function normalize(layout: Layout): Layout {
  let tabs = layout.tabs.map((t) => ({
    items: t.items,
    active: Math.max(0, Math.min(t.active, t.items.length - 1)),
  })) as Layout["tabs"];
  let focused = layout.focused;
  if (!tabs[0].items.length && tabs[1].items.length) {
    tabs = [tabs[1], noTabs()];
    focused = 0;
  }
  if (!tabs[focused].items.length) focused = 0;
  return { tabs, focused };
}

/** Adds (or re-targets) `item` in a pane's tabs right after the active one; returns its index. */
function placeIn(t: PaneTabs, item: PaneItem): PaneTabs {
  const at = t.items.findIndex((x) => same(x, item.kind, item.name));
  if (at !== -1) {
    const items = [...t.items];
    // Keep the tab's own spelling of the name; take the new navigation target.
    items[at] = { ...item, name: items[at].name } as PaneItem;
    return { items, active: at };
  }
  const items = [...t.items];
  const pos = items.length ? t.active + 1 : 0;
  items.splice(pos, 0, item);
  let active = pos;
  // Too many: drop the oldest tab furthest from the one being opened.
  while (items.length > MAX_TABS) {
    const drop = active > 0 ? 0 : items.length - 1;
    items.splice(drop, 1);
    if (drop < active) active--;
  }
  return { items, active };
}

function withoutItem(t: PaneTabs, kind: PaneItem["kind"], name: string): PaneTabs {
  const at = t.items.findIndex((x) => same(x, kind, name));
  return at === -1 ? t : removeAt(t, at);
}

/** Removes a tab; the tab to its right (else left) becomes active if it was. */
function removeAt(t: PaneTabs, index: number): PaneTabs {
  const items = t.items.filter((_, i) => i !== index);
  const active = index < t.active ? t.active - 1 : index === t.active ? Math.min(index, items.length - 1) : t.active;
  return { items, active: Math.max(0, active) };
}

/** Targets are one-shot navigation requests; don't persist them. */
const cleanItem = (p: PaneItem): PaneItem => ("target" in p ? ({ kind: p.kind, name: p.name } as PaneItem) : p);

/**
 * Drops pending targets, so coming back to a tab later restores where you
 * were rather than re-jumping to an old link target.
 */
const settled = (tabs: Layout["tabs"]): Layout["tabs"] =>
  tabs.map((t) => (t.items.some((i) => "target" in i) ? { ...t, items: t.items.map(cleanItem) } : t)) as Layout["tabs"];

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  const persist = () => {
    const { notebook, tabs, focused } = get();
    if (!notebook) return;
    setSettingSoon(`layout:${notebook}`, {
      tabs: tabs.map((t) => ({ items: t.items.map(cleanItem), active: t.active })),
      focused,
    });
  };
  const update = (layout: Layout) => {
    const n = normalize(layout);
    set({ ...n, panes: [current(n.tabs[0]), current(n.tabs[1])] });
    persist();
  };

  return {
    ...EMPTY,
    panes: [null, null],
    notebook: null,

    async loadLayout(notebook) {
      if (!notebook) return set({ ...EMPTY, panes: [null, null], notebook: null });
      const saved = await settings.get<Partial<Layout> & { panes?: [PaneItem | null, PaneItem | null] }>(`layout:${notebook}`);
      // Layouts saved before tabs had one item per pane.
      const tabs: Layout["tabs"] = saved?.tabs ?? [
        saved?.panes?.[0] ? { items: [saved.panes[0]], active: 0 } : noTabs(),
        saved?.panes?.[1] ? { items: [saved.panes[1]], active: 0 } : noTabs(),
      ];
      const n = normalize({ tabs, focused: saved?.focused ?? 0 });
      set({ ...n, panes: [current(n.tabs[0]), current(n.tabs[1])], notebook });
    },

    focus(focused) {
      if (get().focused !== focused) update({ tabs: get().tabs, focused });
    },

    open(item, opts = {}) {
      const { tabs, focused } = get();
      const showing = tabs.findIndex((t) => same(current(t), item.kind, item.name));
      const holding = tabs.findIndex((t) => t.items.some((x) => same(x, item.kind, item.name)));
      let pane: PaneIndex;
      if (opts.pane !== undefined) pane = opts.pane;
      else if (opts.side) pane = holding !== -1 && holding !== focused ? (holding as PaneIndex) : other(focused);
      else if (showing !== -1) pane = showing as PaneIndex;
      else if (holding !== -1) pane = holding as PaneIndex;
      else pane = focused;
      // Only one tab can't move away from its own pane.
      if (!tabs[0].items.length && pane === 1) pane = 0;

      const next: Layout["tabs"] = [tabs[0], tabs[1]];
      // Keep a single copy of an item open: it moves to the pane it's opened in.
      if (holding !== -1 && holding !== pane) next[holding as PaneIndex] = withoutItem(next[holding as PaneIndex], item.kind, item.name);
      next[pane] = placeIn(next[pane], item);
      update({ tabs: next, focused: pane });
    },

    close(pane) {
      const t = get().tabs[pane];
      if (t.items.length) get().closeTab(pane, t.active);
    },

    closeTab(pane, index) {
      const tabs = settled(get().tabs);
      tabs[pane] = removeAt(tabs[pane], index);
      update({ tabs, focused: tabs[pane].items.length ? pane : other(pane) });
    },

    closeOthers(pane, index) {
      const tabs = settled(get().tabs);
      const keep = tabs[pane].items[index];
      if (!keep) return;
      tabs[pane] = { items: [keep], active: 0 };
      update({ tabs, focused: pane });
    },

    activate(pane, index) {
      const tabs = settled(get().tabs);
      tabs[pane] = { ...tabs[pane], active: index };
      update({ tabs, focused: pane });
    },

    moveTab(from, index, to, toIndex) {
      const tabs = settled(get().tabs);
      const item = tabs[from].items[index];
      if (!item) return;
      if (from === to) {
        const items = [...tabs[from].items];
        items.splice(index, 1);
        const at = Math.max(0, Math.min(toIndex > index ? toIndex - 1 : toIndex, items.length));
        items.splice(at, 0, item);
        tabs[from] = { items, active: at };
      } else {
        tabs[from] = removeAt(tabs[from], index);
        const items = tabs[to].items.filter((x) => !same(x, item.kind, item.name));
        const at = Math.max(0, Math.min(toIndex, items.length));
        items.splice(at, 0, item);
        tabs[to] = { items, active: at };
      }
      update({ tabs, focused: to });
    },

    snap(from, index, side) {
      const tabs = settled(get().tabs);
      const item = tabs[from].items[index];
      if (!item) return;
      if (tabs[1].items.length) {
        if (from !== side) get().moveTab(from, index, side, tabs[side].items.length);
        return;
      }
      // One pane: the tab gets a side of its own, the rest keep the other.
      if (tabs[0].items.length < 2) return;
      const rest = removeAt(tabs[0], index);
      const alone: PaneTabs = { items: [item], active: 0 };
      update({ tabs: side === 1 ? [rest, alone] : [alone, rest], focused: side });
    },

    cycle(dir) {
      const { tabs, focused } = get();
      const t = tabs[focused];
      if (t.items.length < 2) return;
      get().activate(focused, (t.active + dir + t.items.length) % t.items.length);
    },

    renameItem(kind, old, name) {
      const tabs = get().tabs.map((t) => ({
        ...t,
        items: t.items.map((p) => (same(p, kind, old) ? { ...p, name } : p)),
      })) as Layout["tabs"];
      update({ tabs, focused: get().focused });
    },

    removeItem(kind, name) {
      const tabs = get().tabs.map((t) => withoutItem(t, kind, name)) as Layout["tabs"];
      update({ tabs, focused: get().focused });
    },

    setLayout(panes, focused) {
      const tabs = panes.map((p) => (p ? { items: [p], active: 0 } : noTabs())) as Layout["tabs"];
      update({ tabs, focused });
    },

    swap() {
      const { tabs, focused } = get();
      if (tabs[1].items.length) update({ tabs: settled([tabs[1], tabs[0]]), focused: other(focused) });
    },
  };
});
