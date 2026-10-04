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
  writeAgentGuide: (content: string) => invoke<boolean>("write_agent_guide", { content }),

  importPdf: (notebook: string, source: string) => invoke<string>("import_pdf", { notebook, source }),
  readPdf: (notebook: string, pdf: string) => invoke<ArrayBuffer>("read_pdf", { notebook, pdf }),
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
