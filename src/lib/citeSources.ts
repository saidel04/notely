import { save } from "@tauri-apps/plugin-dialog";
import { useUi } from "../store/uiStore";
import { useVault } from "../store/vaultStore";
import { formatApaList, formatBibliography, SourceMeta, splitAuthors, yearOf } from "./citations";
import { insertBlock, editors } from "./editorRegistry";
import { parseLinks, sameName } from "./links";
import { resolveRef } from "./navigate";
import { errorMessage, vaultApi } from "./vault";

// Gathers the PDFs a note cites and reads their metadata (title, author, date)
// with pdf.js, which is loaded on demand so it stays out of the startup bundle.

const cache = new Map<string, SourceMeta>();
const toast = (m: string, tone?: "info" | "error") => useUi.getState().toast(m, tone);

/** The PDFs a note links to (any [[file.pdf…]] form), in order of first mention. */
export function citedPdfs(text: string): { notebook: string; name: string }[] {
  const out: { notebook: string; name: string }[] = [];
  for (const l of parseLinks(text)) {
    if (l.kind !== "pdf") continue;
    const ref = resolveRef(l.target, "pdf");
    if (ref && !out.some((o) => sameName(o.notebook, ref.notebook) && sameName(o.name, ref.name))) out.push({ notebook: ref.notebook, name: ref.name });
  }
  return out;
}

async function readMeta(notebook: string, name: string): Promise<SourceMeta> {
  const modified = useVault.getState().notebooks.find((n) => n.name === notebook)?.pdfs.find((p) => p.name === name)?.modified ?? 0;
  const key = `${notebook}/${name}/${modified}`.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const { pdfjs, pdfAssets } = await import("../components/pdf/pdfjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(await vaultApi.readPdf(notebook, name)), ...pdfAssets });
  try {
    const doc = await task.promise;
    const { info, metadata } = (await doc.getMetadata().catch(() => ({ info: {}, metadata: null }))) as {
      info: Record<string, unknown>;
      metadata: { get(k: string): unknown } | null;
    };
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const xmpCreators = metadata?.get("dc:creator");
    const title = str(metadata?.get("dc:title")) ?? str(info.Title);
    const author = Array.isArray(xmpCreators) ? xmpCreators.filter((a): a is string => typeof a === "string") : null;
    const meta: SourceMeta = {
      file: name,
      // Skip junk titles some tools write ("Microsoft Word - draft.docx", the file name).
      title: title && !/^(microsoft word|untitled|\S+\.(docx?|pdf|tex))/i.test(title) ? title : null,
      authors: author?.length ? author : str(info.Author) ? splitAuthors(str(info.Author)!) : [],
      year: yearOf(str(metadata?.get("xmp:createdate")) ?? str(info.CreationDate)),
      pages: doc.numPages,
    };
    cache.set(key, meta);
    return meta;
  } finally {
    void task.destroy();
  }
}

/** Metadata for every PDF the note cites (skipping any that can't be read). */
export async function noteSources(note: string): Promise<SourceMeta[]> {
  const text = useVault.getState().contents[note] ?? "";
  const pdfs = citedPdfs(text);
  const out: SourceMeta[] = [];
  for (const p of pdfs) {
    try {
      out.push(await readMeta(p.notebook, p.name));
    } catch {
      out.push({ file: p.name, title: null, authors: [], year: null, pages: null });
    }
  }
  return out;
}

async function withSources(note: string, run: (sources: SourceMeta[]) => Promise<void> | void) {
  try {
    const sources = await noteSources(note);
    if (!sources.length) return toast("This note doesn't cite any PDFs yet — link one with [[");
    await run(sources);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

export const citations = {
  copyApa: (note: string) =>
    withSources(note, async (s) => {
      await navigator.clipboard.writeText(formatApaList(s).join("\n\n"));
      toast(`Copied ${s.length} APA reference${s.length === 1 ? "" : "s"}`);
    }),

  copyBibtex: (note: string) =>
    withSources(note, async (s) => {
      await navigator.clipboard.writeText(formatBibliography(s));
      toast(`Copied ${s.length} BibTeX entr${s.length === 1 ? "y" : "ies"}`);
    }),

  exportBib: (note: string) =>
    withSources(note, async (s) => {
      const path = await save({
        title: "Export citations",
        defaultPath: `${note.replace(/[\\/:*?"<>|]/g, "")}.bib`,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (!path) return;
      await vaultApi.exportFile(path, formatBibliography(s) + "\n");
      toast(`Exported to ${path.split(/[\\/]/).pop()}`);
    }),

  /** Appends a "References" section (APA) to the end of the open note. */
  insertReferences: (note: string, pane: 0 | 1) =>
    withSources(note, (s) => {
      const view = editors.get(pane);
      if (!view) return;
      const block = `## References\n\n${formatApaList(s).join("\n\n")}`;
      insertBlock(view, `\n${block}`, view.state.doc.length);
      toast(`Added ${s.length} reference${s.length === 1 ? "" : "s"}`);
    }),
};
