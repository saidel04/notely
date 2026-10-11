import { create } from "zustand";
import { parseCanvas, fileNodeTarget } from "../lib/canvas";
import { lineContext, LinkKind, parseLinks, sameName } from "../lib/links";
import { Notebook, vaultApi } from "../lib/vault";

// A vault-wide index of links that name a notebook explicitly ("Biology/Cells").
// It lets backlinks and the link map show mentions from other notebooks, and
// lets renames touch only the files that actually mention the renamed notebook,
// instead of reading every note in the vault. Entries are refreshed from file
// modification times, so only changed files are ever re-read; the index is also
// cached in localStorage so a restart doesn't re-read the whole vault.

export interface IndexedLink {
  /** Notebook named in the link, as written. */
  notebook: string;
  name: string;
  kind: LinkKind;
  /** The line around the link, links rendered as text. */
  context: string;
}

interface NoteEntry {
  modified: number;
  links: IndexedLink[];
}
interface CanvasEntry {
  modified: number;
  /** Lower-cased notebooks that the canvas's file cards point into. */
  notebooks: string[];
}

interface LinkIndexState {
  /** notebook → note → entry */
  notes: Record<string, Record<string, NoteEntry>>;
  /** notebook → canvas → entry */
  canvases: Record<string, Record<string, CanvasEntry>>;
}

export const useLinkIndex = create<LinkIndexState>(() => ({ notes: {}, canvases: {} }));

const VERSION = 1;
let vaultKey: string | null = null;

function indexNote(text: string): IndexedLink[] {
  return parseLinks(text)
    .filter((l) => l.notebook)
    .map((l) => ({ notebook: l.notebook!, name: l.name, kind: l.kind, context: lineContext(text, l) }));
}

function indexCanvas(text: string): string[] {
  const out = new Set<string>();
  for (const n of parseCanvas(text).data.nodes) {
    if (n.type !== "file") continue;
    const t = fileNodeTarget(n.file, "");
    if (t?.notebook) out.add(t.notebook.toLowerCase());
  }
  return [...out];
}

/** Runs `fn` over `items` with at most `limit` in flight (keeps IPC from flooding on big vaults). */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

let running: Promise<void> | null = null;
let again: Notebook[] | null = null;
let saveTimer = 0;

async function runSync(notebooks: Notebook[]) {
  const prev = useLinkIndex.getState();
  const notes: LinkIndexState["notes"] = {};
  const canvases: LinkIndexState["canvases"] = {};
  const jobs: (() => Promise<void>)[] = [];
  let reused = 0;

  for (const nb of notebooks) {
    const oldNotes = prev.notes[nb.name] ?? {};
    const nbNotes: Record<string, NoteEntry> = (notes[nb.name] = {});
    for (const n of nb.notes) {
      const old = oldNotes[n.name];
      if (old && old.modified === n.modified) (nbNotes[n.name] = old), reused++;
      else
        jobs.push(async () => {
          const text = await vaultApi.readNote(nb.name, n.name).catch(() => null);
          if (text !== null) nbNotes[n.name] = { modified: n.modified, links: indexNote(text) };
        });
    }
    const oldCanvases = prev.canvases[nb.name] ?? {};
    const nbCanvases: Record<string, CanvasEntry> = (canvases[nb.name] = {});
    for (const c of nb.canvases) {
      const old = oldCanvases[c.name];
      if (old && old.modified === c.modified) (nbCanvases[c.name] = old), reused++;
      else
        jobs.push(async () => {
          const text = await vaultApi.readCanvas(nb.name, c.name).catch(() => null);
          if (text === null) return;
          try {
            nbCanvases[c.name] = { modified: c.modified, notebooks: indexCanvas(text) };
          } catch {
            // unreadable canvas: no entry, so renames still look at it
          }
        });
    }
  }
  const count = (r: Record<string, Record<string, unknown>>) => Object.values(r).reduce((a, x) => a + Object.keys(x).length, 0);
  // Nothing changed or disappeared: keep the same state object (no re-renders).
  if (!jobs.length && reused === count(prev.notes) + count(prev.canvases)) return;
  await pool(jobs, 8, (job) => job());
  useLinkIndex.setState({ notes, canvases });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 1500);
}

function persist() {
  if (!vaultKey) return;
  try {
    localStorage.setItem(vaultKey, JSON.stringify({ version: VERSION, ...useLinkIndex.getState() }));
  } catch {
    // storage full or unavailable: the index just rebuilds next launch
  }
}

export const linkIndex = {
  /** Switches to a vault, restoring its cached index. */
  load(vaultPath: string | null) {
    vaultKey = vaultPath ? `notely:linkindex:${vaultPath.toLowerCase()}` : null;
    let restored: LinkIndexState = { notes: {}, canvases: {} };
    try {
      const raw = vaultKey ? localStorage.getItem(vaultKey) : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.version === VERSION) restored = { notes: parsed.notes ?? {}, canvases: parsed.canvases ?? {} };
    } catch {
      // corrupt cache: start over
    }
    useLinkIndex.setState(restored);
  },

  /** Brings the index up to date with the given vault listing; reads only changed files. */
  async sync(notebooks: Notebook[]): Promise<void> {
    if (running) {
      again = notebooks;
      return running;
    }
    running = (async () => {
      try {
        await runSync(notebooks);
        while (again) {
          const next = again;
          again = null;
          await runSync(next);
        }
      } finally {
        running = null;
      }
    })();
    return running;
  },

  /** Carries entries across a notebook rename (file times don't change, so nothing is re-read). */
  renameNotebook(old: string, next: string) {
    useLinkIndex.setState((s) => {
      const notes = { ...s.notes };
      const canvases = { ...s.canvases };
      if (notes[old]) (notes[next] = notes[old]), delete notes[old];
      if (canvases[old]) (canvases[next] = canvases[old]), delete canvases[old];
      return { notes, canvases };
    });
  },

  /** Whether a note may contain links into `target` notebook (true when unknown). */
  noteMentions(notebook: string, note: string, target: string) {
    const e = useLinkIndex.getState().notes[notebook]?.[note];
    return !e || e.links.some((l) => sameName(l.notebook, target));
  },

  /** Whether a canvas may have cards pointing into `target` notebook (true when unknown). */
  canvasMentions(notebook: string, canvas: string, target: string) {
    const e = useLinkIndex.getState().canvases[notebook]?.[canvas];
    return !e || e.notebooks.includes(target.toLowerCase());
  },
};

export interface ExternalMention {
  notebook: string;
  note: string;
  link: IndexedLink;
}

/** Links from notes in *other* notebooks into `notebook`, optionally to one item. */
export function externalMentions(
  notes: LinkIndexState["notes"],
  notebook: string,
  item?: { name: string; kind: LinkKind },
): ExternalMention[] {
  const out: ExternalMention[] = [];
  for (const [nb, entries] of Object.entries(notes)) {
    if (sameName(nb, notebook)) continue;
    for (const [note, e] of Object.entries(entries)) {
      for (const link of e.links) {
        if (!sameName(link.notebook, notebook)) continue;
        if (item && (link.kind !== item.kind || !sameName(link.name, item.name))) continue;
        out.push({ notebook: nb, note, link });
      }
    }
  }
  return out;
}
