import { save } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import { Highlight, useHighlights } from "../store/highlightStore";
import { useUi } from "../store/uiStore";
import { useVault } from "../store/vaultStore";
import { freshNotes, useWorkspace } from "../store/workspaceStore";
import { formatLink, parseLinks } from "./links";
import { sanitizeHtml } from "./markdown";
import { resolveRef } from "./navigate";
import { errorMessage, vaultApi } from "./vault";

const pdfTitle = (pdf: string) => pdf.replace(/\.pdf$/i, "");
const toast = (m: string, tone?: "info" | "error") => useUi.getState().toast(m, tone);

/**
 * Rewrites wiki links into plain Markdown that reads well outside Notely:
 * notes and PDFs become their names, pages become citations, and highlight
 * links become the quoted passage with its source.
 */
export async function resolveLinksForExport(_notebook: string, text: string): Promise<string> {
  const links = parseLinks(text);
  const hls = new Map<string, Highlight[]>();
  for (const l of links) {
    const ref = l.kind === "pdf" && l.highlightId ? resolveRef(l.target, "pdf") : null;
    if (ref && !hls.has(l.target)) hls.set(l.target, await useHighlights.getState().ensure(ref.notebook, ref.name));
  }
  let out = "";
  let last = 0;
  for (const l of links) {
    out += text.slice(last, l.from);
    last = l.to;
    if (l.kind === "note" || l.kind === "canvas") {
      out += l.alias ?? l.name.replace(/\.canvas$/i, "");
      continue;
    }
    const title = pdfTitle(resolveRef(l.target, "pdf")?.name ?? l.name);
    if (l.highlightId) {
      const h = hls.get(l.target)?.find((x) => x.id === l.highlightId);
      if (l.alias) out += h ? `${l.alias} (“${h.text}”, *${title}*, p. ${h.page})` : l.alias;
      else out += h ? `“${h.text}” (*${title}*, p. ${h.page})` : `*${title}*`;
    } else if (l.page) {
      out += l.alias ? `${l.alias} (*${title}*, p. ${l.page})` : `*${title}*, p. ${l.page}`;
    } else {
      out += l.alias ?? `*${title}*`;
    }
  }
  return out + text.slice(last);
}

async function saveText(defaultName: string, ext: string, content: string) {
  const path = await save({
    title: "Export",
    defaultPath: `${defaultName.replace(/[\\/:*?"<>|]/g, "")}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return false;
  try {
    await vaultApi.exportFile(path, content);
    toast(`Exported to ${path.split(/[\\/]/).pop()}`);
    return true;
  } catch (e) {
    toast(errorMessage(e), "error");
    return false;
  }
}

async function noteMarkdown(note: string) {
  const nb = useVault.getState().activeNotebook!;
  const body = useVault.getState().contents[note] ?? (await vaultApi.readNote(nb, note));
  const resolved = await resolveLinksForExport(nb, body);
  // Prepend the title unless the note already opens with it as a heading.
  const startsWithTitle = new RegExp(`^#\\s+${note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(
    resolved.split("\n").find((l) => l.trim()) ?? "",
  );
  return startsWithTitle ? resolved : `# ${note}\n\n${resolved}`;
}

export async function exportNoteMarkdown(note: string) {
  await saveText(note, "md", await noteMarkdown(note));
}

const PRINT_CSS = `
  @page { margin: 22mm 20mm; }
  body { font: 11.5pt/1.65 "Source Serif 4 Variable", Georgia, serif; color: #1d1d1b; max-width: 680px; margin: 0 auto; }
  h1, h2, h3 { font-family: "Inter Variable", "Segoe UI", sans-serif; letter-spacing: -0.01em; line-height: 1.25; }
  h1 { font-size: 22pt; margin: 0 0 14pt; }
  h2 { font-size: 15pt; margin: 20pt 0 6pt; }
  h3 { font-size: 12.5pt; margin: 16pt 0 4pt; }
  blockquote { margin: 10pt 0; padding: 2pt 0 2pt 12pt; border-left: 2px solid #c9c8c2; color: #4a4a46; }
  code { font: 9.5pt "Cascadia Code", Consolas, monospace; background: #f1f0ec; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f6f5f2; padding: 10pt; border-radius: 4px; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 18pt 0; }
  ul.contains-task-list { list-style: none; padding-left: 4pt; }
  img { max-width: 100%; }
  a { color: inherit; }
`;

/** Prints the note through the system dialog, where "Microsoft Print to PDF" saves a PDF. */
export async function printNote(note: string) {
  const md = await noteMarkdown(note);
  // Sanitized: notes may contain HTML from other sources, and this runs in our origin.
  const html = sanitizeHtml(await marked.parse(md, { gfm: true }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  // Fonts are copied over so the print matches the app's typography.
  const fontCss = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    })
    .filter((r) => r instanceof CSSFontFaceRule)
    .map((r) => r.cssText)
    .join("\n");
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${note}</title><style>${fontCss}${PRINT_CSS}</style></head><body>${html}</body></html>`,
  );
  doc.close();
  await doc.fonts?.ready;
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  window.setTimeout(() => frame.remove(), 1000);
}

function highlightsMarkdown(pdf: string, list: Highlight[], linked: boolean) {
  const lines = [`# ${pdfTitle(pdf)} — highlights`, ""];
  let page = -1;
  for (const h of list) {
    if (h.page !== page) {
      page = h.page;
      lines.push(`## Page ${page}`, "");
    }
    lines.push(`> ${h.text}`);
    if (linked) lines.push(`> ${formatLink(pdf, h.id, "source")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function exportHighlights(pdf: string) {
  const nb = useVault.getState().activeNotebook!;
  const list = await useHighlights.getState().ensure(nb, pdf);
  if (!list.length) return toast("This PDF has no highlights yet");
  await saveText(`${pdfTitle(pdf)} highlights`, "md", highlightsMarkdown(pdf, list, false));
}

/** Creates a note collecting every highlight, each linking back to its passage. */
export async function noteFromHighlights(pdf: string) {
  const nb = useVault.getState().activeNotebook!;
  const list = await useHighlights.getState().ensure(nb, pdf);
  if (!list.length) return toast("This PDF has no highlights yet");
  const body = highlightsMarkdown(pdf, list, true).split("\n").slice(2).join("\n");
  const name = await useVault.getState().createNote(`${pdfTitle(pdf)} highlights`, body);
  if (!name) return;
  freshNotes.delete(name);
  useWorkspace.getState().open({ kind: "note", name }, { side: true });
}
