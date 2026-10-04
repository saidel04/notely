import { create } from "zustand";
import { CanvasData, loadCanvas, serializeCanvas } from "../lib/canvas";
import { errorMessage, FileMeta, vaultApi } from "../lib/vault";
import { useUi } from "./uiStore";

interface CanvasStore {
  notebook: string | null;
  /** Parsed canvases of the active notebook, keyed by canvas name. */
  data: Record<string, CanvasData>;
  /** Canvases whose file could not be parsed (so we never overwrite them). */
  broken: Record<string, string>;
  sync(notebook: string, metas: FileMeta[], force?: boolean): Promise<void>;
  set(name: string, data: CanvasData): void;
  rename(old: string, next: string): void;
  remove(name: string): void;
}

const pending = new Map<string, number>();
const recentWrites = new Map<string, string[]>();
const modified = new Map<string, number>();

function rememberWrite(name: string, text: string) {
  recentWrites.set(name, [...(recentWrites.get(name) ?? []).slice(-4), text]);
}

async function write(notebook: string, name: string, text: string) {
  rememberWrite(name, text);
  try {
    await vaultApi.writeCanvas(notebook, name, text);
  } catch (e) {
    useUi.getState().toast(errorMessage(e), "error");
  }
}

export const useCanvases = create<CanvasStore>((set, get) => ({
  notebook: null,
  data: {},
  broken: {},

  async sync(notebook, metas, force = false) {
    if (force || get().notebook !== notebook) {
      modified.clear();
      set({ notebook, data: {}, broken: {} });
    }
    const keep = new Set(metas.map((m) => m.name));
    const data = { ...get().data };
    const broken = { ...get().broken };
    for (const name of Object.keys(data)) if (!keep.has(name)) delete data[name];

    await Promise.all(
      metas.map(async (m) => {
        if (modified.get(m.name) === m.modified && (m.name in data || m.name in broken)) return;
        if (pending.has(m.name)) return; // the user is mid-edit; our save wins
        try {
          const text = await vaultApi.readCanvas(notebook, m.name);
          modified.set(m.name, m.modified);
          if (recentWrites.get(m.name)?.includes(text) && m.name in data) return;
          const loaded = loadCanvas(text);
          data[m.name] = loaded.data;
          delete broken[m.name];
          // Agent-written canvases may omit positions; persist the computed layout.
          if (loaded.changed) void write(notebook, m.name, serializeCanvas(loaded.data));
        } catch (e) {
          broken[m.name] = errorMessage(e);
        }
      }),
    );
    if (get().notebook === notebook) set({ data, broken });
  },

  set(name, canvas) {
    const notebook = get().notebook;
    if (!notebook) return;
    set((s) => ({ data: { ...s.data, [name]: canvas } }));
    window.clearTimeout(pending.get(name));
    pending.set(
      name,
      window.setTimeout(() => {
        pending.delete(name);
        void write(notebook, name, serializeCanvas(get().data[name] ?? canvas));
      }, 400),
    );
  },

  rename(old, next) {
    set((s) => {
      const data = { ...s.data };
      if (old in data) {
        data[next] = data[old];
        delete data[old];
      }
      return { data };
    });
  },

  remove(name) {
    window.clearTimeout(pending.get(name));
    pending.delete(name);
    set((s) => {
      const data = { ...s.data };
      delete data[name];
      return { data };
    });
  },
}));

/** Writes any pending canvas edits immediately (before renames, notebook switches, quitting). */
export async function flushCanvases() {
  const { notebook, data } = useCanvases.getState();
  if (!notebook) return;
  const names = [...pending.keys()];
  names.forEach((n) => window.clearTimeout(pending.get(n)));
  pending.clear();
  await Promise.all(names.filter((n) => data[n]).map((n) => write(notebook, n, serializeCanvas(data[n]))));
}

window.addEventListener("beforeunload", () => void flushCanvases());
