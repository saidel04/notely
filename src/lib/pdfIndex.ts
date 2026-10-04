import { pdfAssets, pdfjs } from "../components/pdf/pdfjs";
import { extractAll } from "./pdfText";
import { vaultApi } from "./vault";

// Page texts of each PDF, for notebook-wide search. Extracted once, then cached
// in `.notely/cache/` and keyed by the file's modified time.

interface Cached {
  modified: number;
  pages: string[];
}

const memory = new Map<string, Cached>();
const inflight = new Map<string, Promise<string[]>>();

export async function getPdfPages(notebook: string, pdf: string, modified: number): Promise<string[]> {
  const key = `${notebook}/${pdf}`.toLowerCase();
  const hit = memory.get(key);
  if (hit?.modified === modified) return hit.pages;
  if (inflight.has(key)) return inflight.get(key)!;

  const job = (async () => {
    try {
      const raw = await vaultApi.readTextCache(notebook, pdf);
      if (raw) {
        const disk = JSON.parse(raw) as Cached;
        if (disk.modified === modified) {
          memory.set(key, disk);
          return disk.pages;
        }
      }
    } catch {
      // Corrupt cache: fall through and rebuild it.
    }
    const buf = await vaultApi.readPdf(notebook, pdf);
    const task = pdfjs.getDocument({ data: new Uint8Array(buf), ...pdfAssets });
    try {
      const doc = await task.promise;
      const pages = (await extractAll(doc)).map((p) => p.text);
      const entry = { modified, pages };
      memory.set(key, entry);
      void vaultApi.writeTextCache(notebook, pdf, JSON.stringify(entry)).catch(() => {});
      return pages;
    } finally {
      void task.destroy();
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
