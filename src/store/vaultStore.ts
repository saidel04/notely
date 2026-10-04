import { create } from "zustand";
import { AGENT_GUIDE } from "../lib/agentGuide";
import { CanvasData, fileNodePath, fileNodeTarget, parseCanvas, serializeCanvas } from "../lib/canvas";
import { rewriteLinks, rewriteNotebookPrefix, sameName } from "../lib/links";
import { settings } from "../lib/settings";
import { errorMessage, Notebook, validateName, vaultApi } from "../lib/vault";
import { flushCanvases, useCanvases } from "./canvasStore";
import { useUi } from "./uiStore";
import { useWorkspace } from "./workspaceStore";

interface VaultStore {
  vaultPath: string | null;
  notebooks: Notebook[];
  activeNotebook: string | null;
  /** Markdown of every note in the active notebook, keyed by note name. */
  contents: Record<string, string>;
  ready: boolean;

  init(): Promise<void>;
  openVault(path: string): Promise<void>;
  closeVault(): Promise<void>;
  refresh(): Promise<void>;
  setActiveNotebook(name: string | null): Promise<void>;
  reloadContents(onlyChanged?: boolean): Promise<void>;

  createNotebook(name: string): Promise<string | null>;
  renameNotebook(old: string, next: string): Promise<boolean>;
  deleteNotebook(name: string): Promise<void>;

  createNote(name?: string, content?: string): Promise<string | null>;
  renameNote(old: string, next: string): Promise<boolean>;
  deleteNote(name: string): Promise<void>;

  importPdfs(paths: string[]): Promise<string[]>;
  renamePdf(old: string, next: string): Promise<boolean>;
  deletePdf(name: string): Promise<void>;

  createCanvas(name?: string, content?: string): Promise<string | null>;
  renameCanvas(old: string, next: string): Promise<boolean>;
  deleteCanvas(name: string): Promise<void>;
}

const toast = (m: string, tone?: "info" | "error") => useUi.getState().toast(m, tone);
const fail = (e: unknown) => toast(errorMessage(e), "error");

// ---------- debounced note saving ----------

interface Pending {
  notebook: string;
  note: string;
  content: string;
  timer: number;
}
const pending = new Map<string, Pending>();
/** Recent contents we wrote ourselves, so file-watcher echoes are not mistaken for external edits. */
const recentWrites = new Map<string, string[]>();
const key = (notebook: string, note: string) => `${notebook}/${note}`.toLowerCase();

async function writeNow(p: Pending) {
  const k = key(p.notebook, p.note);
  const list = recentWrites.get(k) ?? [];
  recentWrites.set(k, [...list.slice(-4), p.content]);
  try {
    await vaultApi.writeNote(p.notebook, p.note, p.content);
  } catch (e) {
    fail(e);
  }
}

export const noteSaver = {
  schedule(notebook: string, note: string, content: string) {
    const k = key(notebook, note);
    window.clearTimeout(pending.get(k)?.timer);
    const p: Pending = { notebook, note, content, timer: 0 };
    p.timer = window.setTimeout(() => {
      pending.delete(k);
      void writeNow(p);
    }, 500);
    pending.set(k, p);
    // Keep the in-memory index current so backlinks/autocomplete update while typing.
    if (useVault.getState().activeNotebook === notebook) {
      useVault.setState((s) => ({ contents: { ...s.contents, [note]: content } }));
    }
  },
  async flushAll() {
    const all = [...pending.values()];
    pending.clear();
    all.forEach((p) => window.clearTimeout(p.timer));
    await Promise.all([...all.map(writeNow), flushCanvases()]);
  },
  isPending: (notebook: string, note: string) => pending.has(key(notebook, note)),
  isOwnWrite: (notebook: string, note: string, content: string) =>
    recentWrites.get(key(notebook, note))?.includes(content) ?? false,
};

window.addEventListener("beforeunload", () => void noteSaver.flushAll());

// ---------- store ----------

let lastModified = new Map<string, number>();

export const useVault = create<VaultStore>((set, get) => ({
  vaultPath: null,
  notebooks: [],
  activeNotebook: null,
  contents: {},
  ready: false,

  async init() {
    const path = await settings.get<string>("vaultPath");
    if (path) {
      try {
        await get().openVault(path);
      } catch {
        await settings.set("vaultPath", null);
      }
    }
    set({ ready: true });
  },

  async openVault(path) {
    await vaultApi.open(path);
    await settings.set("vaultPath", path);
    // Keep the vault's agent guide current (skipped if the user wrote their own AGENTS.md).
    void vaultApi.writeAgentGuide(AGENT_GUIDE).catch(() => {});
    set({ vaultPath: path });
    await get().refresh();
    let { notebooks } = get();
    if (notebooks.length === 0) {
      await vaultApi.createNotebook("My Notebook");
      await get().refresh();
      notebooks = get().notebooks;
    }
    const last = await settings.get<string>("lastNotebook");
    const pick = notebooks.find((n) => n.name === last)?.name ?? notebooks[0]?.name ?? null;
    await get().setActiveNotebook(pick);
  },

  async closeVault() {
    await noteSaver.flushAll();
    await settings.set("vaultPath", null);
    await useWorkspace.getState().loadLayout(null);
    set({ vaultPath: null, notebooks: [], activeNotebook: null, contents: {} });
  },

  async refresh() {
    try {
      const notebooks = await vaultApi.list();
      set({ notebooks });
      const active = get().activeNotebook;
      if (active && !notebooks.some((n) => n.name === active)) {
        await get().setActiveNotebook(notebooks[0]?.name ?? null);
      }
    } catch (e) {
      fail(e);
    }
  },

  async setActiveNotebook(name) {
    await noteSaver.flushAll();
    set({ activeNotebook: name, contents: {} });
    useUi.setState({ tagFilter: null });
    lastModified = new Map();
    await useWorkspace.getState().loadLayout(name);
    if (name) void settings.set("lastNotebook", name);
    await get().reloadContents(false);
  },

  async reloadContents(onlyChanged = true) {
    const nbName = get().activeNotebook;
    const nb = get().notebooks.find((n) => n.name === nbName);
    if (!nbName || !nb) return;
    const next: Record<string, string> = {};
    const current = get().contents;
    await Promise.all(
      nb.notes.map(async ({ name, modified }) => {
        const unchanged = onlyChanged && lastModified.get(name) === modified && name in current;
        // Never clobber what the user is typing with a stale disk read.
        if (unchanged || noteSaver.isPending(nbName, name)) {
          next[name] = current[name] ?? "";
          return;
        }
        try {
          const text = await vaultApi.readNote(nbName, name);
          next[name] = noteSaver.isOwnWrite(nbName, name, text) && name in current ? current[name] : text;
          lastModified.set(name, modified);
        } catch {
          next[name] = current[name] ?? "";
        }
      }),
    );
    if (get().activeNotebook === nbName) set({ contents: next });
    await useCanvases.getState().sync(nbName, nb.canvases);
  },

  // ----- notebooks -----

  async createNotebook(name) {
    try {
      const created = await vaultApi.createNotebook(name.trim());
      await get().refresh();
      await get().setActiveNotebook(created);
      return created;
    } catch (e) {
      fail(e);
      return null;
    }
  },

  async renameNotebook(old, next) {
    next = next.trim();
    if (old === next) return true;
    const invalid = validateName(next);
    if (invalid) return toast(invalid, "error"), false;
    try {
      await noteSaver.flushAll();
      await vaultApi.renameNotebook(old, next);
      const layout = await settings.get(`layout:${old}`);
      if (layout) await settings.set(`layout:${next}`, layout);
      if (get().activeNotebook === old) {
        set({ activeNotebook: next });
        useWorkspace.setState({ notebook: next });
        void settings.set("lastNotebook", next);
      }
      await get().refresh();
      // Links into this notebook from anywhere in the vault: "Old/…" → "New/…".
      const changed = await rewriteVault(
        null,
        (text) => rewriteNotebookPrefix(text, old, next),
        (file) => (file.toLowerCase().startsWith(old.toLowerCase() + "/") ? `${next}/${file.slice(old.length + 1)}` : null),
      );
      if (changed) toast(`Updated links in ${changed} file${changed === 1 ? "" : "s"}`);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  },

  async deleteNotebook(name) {
    try {
      await noteSaver.flushAll();
      await vaultApi.deleteNotebook(name);
      if (get().activeNotebook === name) set({ activeNotebook: null });
      await get().refresh();
      if (!get().activeNotebook) await get().setActiveNotebook(get().notebooks[0]?.name ?? null);
      toast(`Moved “${name}” to the Recycle Bin`);
    } catch (e) {
      fail(e);
    }
  },

  // ----- notes -----

  async createNote(name = "Untitled", content = "") {
    const nb = get().activeNotebook;
    if (!nb) return null;
    try {
      const created = await vaultApi.createNote(nb, name.trim(), content);
      set((s) => ({ contents: { ...s.contents, [created]: content } }));
      await get().refresh();
      return created;
    } catch (e) {
      fail(e);
      return null;
    }
  },

  async renameNote(old, next) {
    const nb = get().activeNotebook;
    next = next.trim();
    if (!nb || old === next) return true;
    const invalid = validateName(next);
    if (invalid) return toast(invalid, "error"), false;
    try {
      await noteSaver.flushAll();
      await vaultApi.renameNote(nb, old, next);
      useWorkspace.getState().renameItem("note", old, next);
      await rewriteEverywhere(nb, old, next, old);
      rewriteCanvasFiles(nb, "note", old, next);
      await rewriteOtherNotebooks(nb, "note", old, next);
      await get().refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  },

  async deleteNote(name) {
    const nb = get().activeNotebook;
    if (!nb) return;
    try {
      await noteSaver.flushAll();
      await vaultApi.deleteNote(nb, name);
      useWorkspace.getState().removeItem("note", name);
      set((s) => {
        const contents = { ...s.contents };
        delete contents[name];
        return { contents };
      });
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  // ----- pdfs -----

  async importPdfs(paths) {
    const nb = get().activeNotebook;
    if (!nb) return [];
    const names: string[] = [];
    for (const p of paths.filter((p) => p.toLowerCase().endsWith(".pdf"))) {
      try {
        names.push(await vaultApi.importPdf(nb, p));
      } catch (e) {
        fail(e);
      }
    }
    if (names.length) {
      await get().refresh();
      toast(names.length === 1 ? `Imported ${names[0]}` : `Imported ${names.length} PDFs`);
    }
    return names;
  },

  async renamePdf(old, next) {
    const nb = get().activeNotebook;
    next = next.trim();
    if (!/\.pdf$/i.test(next)) next += ".pdf";
    if (!nb || old === next) return true;
    const invalid = validateName(next);
    if (invalid) return toast(invalid, "error"), false;
    try {
      await noteSaver.flushAll();
      await vaultApi.renamePdf(nb, old, next);
      useWorkspace.getState().renameItem("pdf", old, next);
      await rewriteEverywhere(nb, old, next);
      rewriteCanvasFiles(nb, "pdf", old, next);
      await rewriteOtherNotebooks(nb, "pdf", old, next);
      await get().refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  },

  // ----- canvases -----

  async createCanvas(name = "Untitled canvas", content) {
    const nb = get().activeNotebook;
    if (!nb) return null;
    try {
      const created = await vaultApi.createCanvas(nb, name.trim(), content);
      await get().refresh();
      await useCanvases.getState().sync(nb, findNotebook(nb)?.canvases ?? []);
      return created;
    } catch (e) {
      fail(e);
      return null;
    }
  },

  async renameCanvas(old, next) {
    const nb = get().activeNotebook;
    next = next.trim().replace(/\.canvas$/i, "");
    if (!nb || old === next) return true;
    const invalid = validateName(next);
    if (invalid) return toast(invalid, "error"), false;
    try {
      await noteSaver.flushAll();
      await vaultApi.renameCanvas(nb, old, next);
      useCanvases.getState().rename(old, next);
      useWorkspace.getState().renameItem("canvas", old, next);
      await rewriteEverywhere(nb, `${old}.canvas`, `${next}.canvas`);
      rewriteCanvasFiles(nb, "canvas", old, next);
      await rewriteOtherNotebooks(nb, "canvas", old, next);
      await get().refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  },

  async deleteCanvas(name) {
    const nb = get().activeNotebook;
    if (!nb) return;
    try {
      useCanvases.getState().remove(name);
      await vaultApi.deleteCanvas(nb, name);
      useWorkspace.getState().removeItem("canvas", name);
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  async deletePdf(name) {
    const nb = get().activeNotebook;
    if (!nb) return;
    try {
      await vaultApi.deletePdf(nb, name);
      useWorkspace.getState().removeItem("pdf", name);
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },
}));

/** Rewrites links to a renamed note/PDF in every note of the notebook. */
async function rewriteEverywhere(nb: string, old: string, next: string, renamedNote?: string) {
  const contents = { ...useVault.getState().contents };
  if (renamedNote && renamedNote in contents) {
    contents[next] = contents[renamedNote];
    delete contents[renamedNote];
  }
  let changed = 0;
  for (const [name, text] of Object.entries(contents)) {
    const updated = rewriteLinks(text, old, next);
    if (updated === text) continue;
    contents[name] = updated;
    await writeNow({ notebook: nb, note: name, content: updated, timer: 0 });
    changed++;
  }
  useVault.setState({ contents });
  if (changed) toast(`Updated links in ${changed} note${changed === 1 ? "" : "s"}`);
}

/** Points canvas cards at a renamed note/PDF/canvas. */
function rewriteCanvasFiles(nb: string, kind: "note" | "pdf" | "canvas", old: string, next: string) {
  const store = useCanvases.getState();
  for (const [name, data] of Object.entries(store.data)) {
    let changed = false;
    const nodes = data.nodes.map((n) => {
      if (n.type !== "file") return n;
      const t = fileNodeTarget(n.file, nb);
      if (!t || !sameName(t.notebook, nb) || t.kind !== kind || !sameName(t.name, old)) return n;
      changed = true;
      return { ...n, file: fileNodePath(nb, kind, next) };
    });
    if (changed) store.set(kind === "canvas" && sameName(name, old) ? next : name, { ...data, nodes } as CanvasData);
  }
}

/**
 * Applies a rewrite to every note — and every canvas card path — in the vault
 * (optionally skipping one notebook), writing only files that change.
 */
async function rewriteVault(skip: string | null, noteFn: (text: string) => string, fileFn?: (file: string) => string | null) {
  let changed = 0;
  for (const nb of useVault.getState().notebooks) {
    if (skip && nb.name === skip) continue;
    for (const n of nb.notes) {
      const text = await vaultApi.readNote(nb.name, n.name).catch(() => null);
      if (text === null) continue;
      const updated = noteFn(text);
      if (updated !== text) {
        await writeNow({ notebook: nb.name, note: n.name, content: updated, timer: 0 });
        changed++;
      }
    }
    if (!fileFn) continue;
    for (const c of nb.canvases) {
      try {
        const data = parseCanvas(await vaultApi.readCanvas(nb.name, c.name)).data;
        let touched = false;
        for (const node of data.nodes) {
          if (node.type !== "file") continue;
          const nextFile = fileFn(node.file);
          if (nextFile && nextFile !== node.file) {
            node.file = nextFile;
            touched = true;
          }
        }
        if (touched) {
          await vaultApi.writeCanvas(nb.name, c.name, serializeCanvas(data));
          changed++;
        }
      } catch {
        // unreadable canvas: leave it alone
      }
    }
  }
  return changed;
}

/** After renaming an item in `nb`, fixes "nb/old" links and cards in the other notebooks. */
async function rewriteOtherNotebooks(nb: string, kind: "note" | "pdf" | "canvas", old: string, next: string) {
  const suffix = kind === "canvas" ? ".canvas" : "";
  const changed = await rewriteVault(
    nb,
    (text) => rewriteLinks(text, `${nb}/${old}${suffix}`, `${nb}/${next}${suffix}`),
    (file) => {
      const t = fileNodeTarget(file, "");
      return t && sameName(t.notebook, nb) && t.kind === kind && sameName(t.name, old) ? fileNodePath(nb, kind, next) : null;
    },
  );
  if (changed) toast(`Also updated links in ${changed} file${changed === 1 ? "" : "s"} in other notebooks`);
}

export const findNotebook = (name: string | null) =>
  useVault.getState().notebooks.find((n) => n.name === name) ?? null;

export const noteExists = (name: string) =>
  !!findNotebook(useVault.getState().activeNotebook)?.notes.some((n) => sameName(n.name, name));

export const pdfExists = (name: string) =>
  !!findNotebook(useVault.getState().activeNotebook)?.pdfs.some((n) => sameName(n.name, name));
