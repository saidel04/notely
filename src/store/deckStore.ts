import { create } from "zustand";
import { errorMessage, FileMeta, vaultApi } from "../lib/vault";
import { useUi } from "./uiStore";

// The text of every flashcard deck in the active notebook, kept in memory so
// the deck views, the review session and the sidebar counts all see the same
// thing while it is being edited. Saved back to `<notebook>/<deck>.cards`.

interface DeckStore {
  notebook: string | null;
  /** Raw file text, keyed by deck name. */
  text: Record<string, string>;
  sync(notebook: string, metas: FileMeta[], force?: boolean): Promise<void>;
  set(name: string, text: string): void;
  rename(old: string, next: string): void;
  remove(name: string): void;
}

const pending = new Map<string, number>();
const recentWrites = new Map<string, string[]>();
const modified = new Map<string, number>();

async function write(notebook: string, name: string, text: string) {
  recentWrites.set(name, [...(recentWrites.get(name) ?? []).slice(-4), text]);
  try {
    await vaultApi.writeDeck(notebook, name, text);
  } catch (e) {
    useUi.getState().toast(errorMessage(e), "error");
  }
}

export const useDecks = create<DeckStore>((set, get) => ({
  notebook: null,
  text: {},

  async sync(notebook, metas, force = false) {
    if (force || get().notebook !== notebook) {
      modified.clear();
      set({ notebook, text: {} });
    }
    const keep = new Set(metas.map((m) => m.name));
    const text = { ...get().text };
    for (const name of Object.keys(text)) if (!keep.has(name)) delete text[name];

    await Promise.all(
      metas.map(async (m) => {
        if (modified.get(m.name) === m.modified && m.name in text) return;
        if (pending.has(m.name)) return; // mid-edit: our save wins
        try {
          const raw = await vaultApi.readDeck(notebook, m.name);
          modified.set(m.name, m.modified);
          // A file-watcher echo of our own write: keep what's on screen.
          if (recentWrites.get(m.name)?.includes(raw) && m.name in text) return;
          text[m.name] = raw;
        } catch {
          // Unreadable deck: leave it out rather than blank the file on save.
        }
      }),
    );
    if (get().notebook === notebook) set({ text });
  },

  set(name, next) {
    const notebook = get().notebook;
    if (!notebook) return;
    set((s) => ({ text: { ...s.text, [name]: next } }));
    window.clearTimeout(pending.get(name));
    pending.set(
      name,
      window.setTimeout(() => {
        pending.delete(name);
        void write(notebook, name, get().text[name] ?? next);
      }, 400),
    );
  },

  rename(old, next) {
    set((s) => {
      const text = { ...s.text };
      if (old in text) {
        text[next] = text[old];
        delete text[old];
      }
      return { text };
    });
  },

  remove(name) {
    window.clearTimeout(pending.get(name));
    pending.delete(name);
    set((s) => {
      const text = { ...s.text };
      delete text[name];
      return { text };
    });
  },
}));

/** Writes any pending deck edits now (before renames, notebook switches, quitting). */
export async function flushDecks() {
  const { notebook, text } = useDecks.getState();
  if (!notebook) return;
  const names = [...pending.keys()];
  names.forEach((n) => window.clearTimeout(pending.get(n)));
  pending.clear();
  await Promise.all(names.filter((n) => n in text).map((n) => write(notebook, n, text[n])));
}

window.addEventListener("beforeunload", () => void flushDecks());
