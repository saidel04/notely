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
  | { kind: "canvas"; name: string };

export type PaneIndex = 0 | 1;

interface Layout {
  panes: [PaneItem | null, PaneItem | null];
  focused: PaneIndex;
}

interface WorkspaceStore extends Layout {
  notebook: string | null;

  loadLayout(notebook: string | null): Promise<void>;
  focus(pane: PaneIndex): void;
  /** Opens an item; reuses a pane already showing it, otherwise the focused (or other) pane. */
  open(item: PaneItem, opts?: { pane?: PaneIndex; side?: boolean }): void;
  close(pane: PaneIndex): void;
  renameItem(kind: PaneItem["kind"], old: string, next: string): void;
  removeItem(kind: PaneItem["kind"], name: string): void;
  swap(): void;
  setLayout(panes: Layout["panes"], focused: PaneIndex): void;
}

const other = (p: PaneIndex): PaneIndex => (p === 0 ? 1 : 0);
const same = (a: PaneItem | null, kind: PaneItem["kind"], name: string) =>
  !!a && a.kind === kind && sameName(a.name, name);

/** Notes just created from the UI; their editor focuses the title for naming. */
export const freshNotes = new Set<string>();

let nonce = 0;
export const nextNonce = () => ++nonce;

const EMPTY: Layout = { panes: [null, null], focused: 0 };

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  const persist = () => {
    const { notebook, panes, focused } = get();
    if (!notebook) return;
    // Targets are one-shot navigation requests; don't persist them.
    const clean = panes.map((p) => (p && "target" in p ? { kind: p.kind, name: p.name } : p));
    setSettingSoon(`layout:${notebook}`, { panes: clean, focused });
  };
  const update = (patch: Partial<Layout>) => {
    set(patch);
    persist();
  };

  return {
    ...EMPTY,
    notebook: null,

    async loadLayout(notebook) {
      if (!notebook) return set({ ...EMPTY, notebook: null });
      const saved = await settings.get<Layout>(`layout:${notebook}`);
      set({ ...(saved ?? EMPTY), notebook });
    },

    focus(focused) {
      if (get().focused !== focused) update({ focused });
    },

    open(item, opts = {}) {
      const { panes, focused } = get();
      const existing = panes.findIndex((p) => same(p, item.kind, item.name));
      let pane: PaneIndex;
      if (opts.pane !== undefined) pane = opts.pane;
      else if (existing !== -1 && !opts.side) pane = existing as PaneIndex;
      else if (opts.side) pane = existing !== -1 && existing !== focused ? (existing as PaneIndex) : other(focused);
      else pane = focused;

      // Keep a single copy of an item on screen.
      const next: Layout["panes"] = [...panes];
      if (existing !== -1 && existing !== pane) next[existing as PaneIndex] = null;
      next[pane] = item;
      // A lone item always lives in the left pane.
      if (!next[0] && next[1]) {
        next[0] = next[1];
        next[1] = null;
        pane = 0;
      }
      update({ panes: next, focused: pane });
    },

    close(pane) {
      const next: Layout["panes"] = [...get().panes];
      next[pane] = null;
      if (!next[0] && next[1]) {
        next[0] = next[1];
        next[1] = null;
      }
      update({ panes: next, focused: 0 });
    },

    renameItem(kind, old, name) {
      const panes = get().panes.map((p) => (same(p, kind, old) ? { ...p!, name } : p)) as Layout["panes"];
      update({ panes });
    },

    removeItem(kind, name) {
      const { panes } = get();
      ([0, 1] as PaneIndex[])
        .filter((i) => same(panes[i], kind, name))
        .reverse()
        .forEach((i) => get().close(i));
    },

    setLayout(panes, focused) {
      update({ panes, focused });
    },

    swap() {
      const [a, b] = get().panes;
      if (b) update({ panes: [b, a], focused: other(get().focused) });
    },
  };
});
