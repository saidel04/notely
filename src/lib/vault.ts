import { invoke } from "@tauri-apps/api/core";

export interface FileMeta {
  name: string;
  modified: number;
}

export interface Notebook {
  name: string;
  notes: FileMeta[];
  pdfs: FileMeta[];
  canvases: FileMeta[];
  /** Flashcard decks (`.cards` files). */
  decks: FileMeta[];
}

export const vaultApi = {
  open: (path: string) => invoke<void>("open_vault", { path }),
  list: () => invoke<Notebook[]>("list_vault"),

  createNotebook: (name: string) => invoke<string>("create_notebook", { name }),
  renameNotebook: (old: string, next: string) => invoke<void>("rename_notebook", { old, new: next }),
  deleteNotebook: (name: string) => invoke<void>("delete_notebook", { name }),

  readNote: (notebook: string, note: string) => invoke<string>("read_note", { notebook, note }),
  writeNote: (notebook: string, note: string, content: string) =>
    invoke<void>("write_note", { notebook, note, content }),
  createNote: (notebook: string, name: string, content?: string) =>
    invoke<string>("create_note", { notebook, name, content }),
  renameNote: (notebook: string, old: string, next: string) =>
    invoke<void>("rename_note", { notebook, old, new: next }),
  deleteNote: (notebook: string, note: string) => invoke<void>("delete_note", { notebook, note }),

  readCanvas: (notebook: string, canvas: string) => invoke<string>("read_canvas", { notebook, canvas }),
  writeCanvas: (notebook: string, canvas: string, content: string) =>
    invoke<void>("write_canvas", { notebook, canvas, content }),
  createCanvas: (notebook: string, name: string, content?: string) =>
    invoke<string>("create_canvas", { notebook, name, content }),
  renameCanvas: (notebook: string, old: string, next: string) =>
    invoke<void>("rename_canvas", { notebook, old, new: next }),
  deleteCanvas: (notebook: string, canvas: string) => invoke<void>("delete_canvas", { notebook, canvas }),
  readDeck: (notebook: string, deck: string) => invoke<string>("read_deck", { notebook, deck }),
  writeDeck: (notebook: string, deck: string, content: string) =>
    invoke<void>("write_deck", { notebook, deck, content }),
  createDeck: (notebook: string, name: string, content?: string) =>
    invoke<string>("create_deck", { notebook, name, content }),
  renameDeck: (notebook: string, old: string, next: string) =>
    invoke<void>("rename_deck", { notebook, old, new: next }),
  deleteDeck: (notebook: string, deck: string) => invoke<void>("delete_deck", { notebook, deck }),

  writeAgentGuide: (content: string) => invoke<boolean>("write_agent_guide", { content }),

  importPdf: (notebook: string, source: string) => invoke<string>("import_pdf", { notebook, source }),
  readPdf: (notebook: string, pdf: string) => invoke<ArrayBuffer>("read_pdf", { notebook, pdf }),
  restorePdf: (notebook: string, pdf: string, bytes: number[], highlights: string | null) =>
    invoke<void>("restore_pdf", { notebook, pdf, bytes, highlights }),
  renamePdf: (notebook: string, old: string, next: string) =>
    invoke<void>("rename_pdf", { notebook, old, new: next }),
  deletePdf: (notebook: string, pdf: string) => invoke<void>("delete_pdf", { notebook, pdf }),

  readHighlights: (notebook: string, pdf: string) =>
    invoke<string | null>("read_highlights", { notebook, pdf }),
  writeHighlights: (notebook: string, pdf: string, content: string) =>
    invoke<void>("write_highlights", { notebook, pdf, content }),

  readTextCache: (notebook: string, pdf: string) => invoke<string | null>("read_text_cache", { notebook, pdf }),
  writeTextCache: (notebook: string, pdf: string, content: string) =>
    invoke<void>("write_text_cache", { notebook, pdf, content }),

  exportFile: (path: string, content: string) => invoke<void>("export_file", { path, content }),
  exportBytes: (path: string, bytes: Uint8Array) =>
    invoke<void>("export_bytes", bytes, { headers: { "x-path": encodeURIComponent(path) } }),

  /** Saves image bytes into the notebook's `_assets/`; resolves to the file name used. */
  writeAsset: (notebook: string, name: string, bytes: Uint8Array) =>
    invoke<string>("write_asset", bytes, {
      headers: { "x-notebook": encodeURIComponent(notebook), "x-name": encodeURIComponent(name) },
    }),
  importAsset: (notebook: string, source: string) => invoke<string>("import_asset", { notebook, source }),
  readAsset: (notebook: string, name: string) => invoke<ArrayBuffer>("read_asset", { notebook, name }),

  listVersions: (notebook: string, note: string) => invoke<{ time: number; size: number }[]>("list_versions", { notebook, note }),
  readVersion: (notebook: string, note: string, time: number) => invoke<string>("read_version", { notebook, note, time }),
  snapshotNote: (notebook: string, note: string) => invoke<boolean>("snapshot_note", { notebook, note }),

  listTemplates: () => invoke<FileMeta[] | null>("list_templates"),
  readTemplate: (name: string) => invoke<string>("read_template", { name }),
  writeTemplate: (name: string, content: string) => invoke<void>("write_template", { name, content }),

  readReview: (notebook: string) => invoke<string | null>("read_review", { notebook }),
  writeReview: (notebook: string, content: string) => invoke<void>("write_review", { notebook, content }),
};

/** Mirrors the Rust-side `check_name` so we can reject names before a round trip. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Name can't be empty";
  if (n.startsWith(".") || n.endsWith(".")) return "Name can't start or end with a dot";
  if (/[\\/:*?"<>|]/.test(n)) return 'Name can\'t contain \\ / : * ? " < > |';
  return null;
}

export function errorMessage(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong";
}
