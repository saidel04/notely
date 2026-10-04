import { create } from "zustand";
import { errorMessage, vaultApi } from "../lib/vault";
import { useUi } from "./uiStore";

export interface Rect {
  /** 1-based page the rect sits on (a highlight can span pages). */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  id: string;
  /** 1-based page where the highlight starts. */
  page: number;
  /** Rects normalized to 0–1 of the page box, so they survive any zoom level. */
  rects: Rect[];
  text: string;
  color: HighlightColor;
  /** The reader's own comment on this passage. */
  comment?: string;
  createdAt: number;
}

/** A named place in a PDF. Linkable as [[file.pdf#bm-xxxxxx]]. */
export interface Bookmark {
  id: string;
  page: number;
  /** Vertical position on the page, 0–1. */
  y: number;
  name: string;
  createdAt: number;
}

interface HighlightStore {
  /** Keyed by `notebook/pdf`; undefined = not loaded yet. */
  byPdf: Record<string, Highlight[] | undefined>;
  /** Bookmarks, same keys; loaded together with highlights. */
  bookmarks: Record<string, Bookmark[] | undefined>;
  ensure(notebook: string, pdf: string): Promise<Highlight[]>;
  ensureBookmarks(notebook: string, pdf: string): Promise<Bookmark[]>;
  addBookmark(notebook: string, pdf: string, b: Omit<Bookmark, "id" | "createdAt">): Bookmark;
  updateBookmark(notebook: string, pdf: string, id: string, patch: Partial<Bookmark>): void;
  removeBookmark(notebook: string, pdf: string, id: string): void;
  add(notebook: string, pdf: string, h: Omit<Highlight, "id" | "createdAt">): Highlight;
  update(notebook: string, pdf: string, id: string, patch: Partial<Highlight>): void;
  remove(notebook: string, pdf: string, id: string): void;
  forget(notebook: string, pdf: string): void;
}

export const hlKey = (notebook: string, pdf: string) => `${notebook}/${pdf}`.toLowerCase();

const newId = (prefix = "hl") => `${prefix}-` + Math.random().toString(36).slice(2, 8).padEnd(6, "0");

const saveTimers = new Map<string, number>();
const loading = new Map<string, Promise<void>>();

export const useHighlights = create<HighlightStore>((set, get) => {
  const save = (notebook: string, pdf: string) => {
    const k = hlKey(notebook, pdf);
    window.clearTimeout(saveTimers.get(k));
    saveTimers.set(
      k,
      window.setTimeout(() => {
        saveTimers.delete(k);
        const highlights = get().byPdf[k] ?? [];
        const bookmarks = get().bookmarks[k] ?? [];
        vaultApi
          .writeHighlights(notebook, pdf, JSON.stringify({ version: 2, highlights, bookmarks }, null, 2))
          .catch((e) => useUi.getState().toast(errorMessage(e), "error"));
      }, 300),
    );
  };

  const mutate = (notebook: string, pdf: string, fn: (list: Highlight[]) => Highlight[]) => {
    const k = hlKey(notebook, pdf);
    set((s) => ({ byPdf: { ...s.byPdf, [k]: fn(s.byPdf[k] ?? []) } }));
    save(notebook, pdf);
  };

  const mutateBookmarks = (notebook: string, pdf: string, fn: (list: Bookmark[]) => Bookmark[]) => {
    const k = hlKey(notebook, pdf);
    set((s) => ({ bookmarks: { ...s.bookmarks, [k]: fn(s.bookmarks[k] ?? []) } }));
    save(notebook, pdf);
  };

  /** Loads the PDF's annotation file (highlights + bookmarks) once. */
  const load = (notebook: string, pdf: string) => {
    const k = hlKey(notebook, pdf);
    if (get().byPdf[k] && get().bookmarks[k]) return Promise.resolve();
    if (!loading.has(k)) {
      const p = vaultApi
        .readHighlights(notebook, pdf)
        .then((raw) => {
          const parsed = raw ? JSON.parse(raw) : {};
          set((s) => ({
            byPdf: { ...s.byPdf, [k]: s.byPdf[k] ?? ((parsed.highlights as Highlight[]) ?? []) },
            bookmarks: { ...s.bookmarks, [k]: s.bookmarks[k] ?? ((parsed.bookmarks as Bookmark[]) ?? []) },
          }));
        })
        .catch(() => {
          set((s) => ({ byPdf: { ...s.byPdf, [k]: s.byPdf[k] ?? [] }, bookmarks: { ...s.bookmarks, [k]: s.bookmarks[k] ?? [] } }));
        })
        .finally(() => loading.delete(k));
      loading.set(k, p);
    }
    return loading.get(k)!;
  };

  return {
    byPdf: {},
    bookmarks: {},

    async ensure(notebook, pdf) {
      await load(notebook, pdf);
      return get().byPdf[hlKey(notebook, pdf)] ?? [];
    },

    async ensureBookmarks(notebook, pdf) {
      await load(notebook, pdf);
      return get().bookmarks[hlKey(notebook, pdf)] ?? [];
    },

    addBookmark(notebook, pdf, b) {
      const bm: Bookmark = { ...b, id: newId("bm"), createdAt: Date.now() };
      mutateBookmarks(notebook, pdf, (l) => [...l, bm].sort((a, c) => a.page - c.page || a.y - c.y));
      return bm;
    },

    updateBookmark(notebook, pdf, id, patch) {
      mutateBookmarks(notebook, pdf, (l) => l.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },

    removeBookmark(notebook, pdf, id) {
      mutateBookmarks(notebook, pdf, (l) => l.filter((b) => b.id !== id));
    },

    add(notebook, pdf, h) {
      const hl: Highlight = { ...h, id: newId(), createdAt: Date.now() };
      mutate(notebook, pdf, (l) => [...l, hl].sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y));
      return hl;
    },

    update(notebook, pdf, id, patch) {
      mutate(notebook, pdf, (l) => l.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    },

    remove(notebook, pdf, id) {
      mutate(notebook, pdf, (l) => l.filter((h) => h.id !== id));
    },

    forget(notebook, pdf) {
      const k = hlKey(notebook, pdf);
      set((s) => {
        const byPdf = { ...s.byPdf };
        const bookmarks = { ...s.bookmarks };
        delete byPdf[k];
        delete bookmarks[k];
        return { byPdf, bookmarks };
      });
    },
  };
});
