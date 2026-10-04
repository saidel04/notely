// Notely MCP server: lets AI agents (Claude Code, Claude Desktop, Cursor, …) work
// in a Notely vault — notebooks, notes, links, PDFs, highlights and canvases.
// It edits the vault's plain files; the running app picks changes up live.
//
//   node notely-mcp.mjs [--vault <path>]
//
// The vault is taken from --vault, then $NOTELY_VAULT, then the Notely app's settings.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { AGENT_GUIDE } from "../src/lib/agentGuide";
import {
  autoLayout,
  CanvasData,
  canvasText,
  Direction,
  fileNodePath,
  fileNodeTarget,
  normalizeCanvas,
  parseCanvas,
  serializeCanvas,
} from "../src/lib/canvas";
import { formatLink, parseLinks, rewriteLinks, sameName } from "../src/lib/links";
import { tagsIn } from "../src/lib/tags";
import { buildPageText, findInPages, snippet } from "../src/lib/pdfText";

// ---------- vault location ----------

function settingsVault(): string | null {
  const dirs =
    process.platform === "win32"
      ? [process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")]
      : process.platform === "darwin"
        ? [path.join(os.homedir(), "Library", "Application Support")]
        : [process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")];
  for (const d of dirs) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(d, "com.notely.app", "settings.json"), "utf8"));
      if (typeof s.vaultPath === "string") return s.vaultPath;
    } catch {
      // no settings yet
    }
  }
  return null;
}

const argIdx = process.argv.indexOf("--vault");
const VAULT = path.resolve(
  (argIdx > -1 ? process.argv[argIdx + 1] : null) ?? process.env.NOTELY_VAULT ?? settingsVault() ?? path.join(os.homedir(), "Documents", "Notely"),
);

// ---------- safe paths & io ----------

class UserError extends Error {}

function checkName(name: string, what = "name"): string {
  const bad =
    !name ||
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    /[\\/:*?"<>|\u0000-\u001f]/.test(name);
  if (bad) throw new UserError(`Invalid ${what} "${name}": avoid \\ / : * ? " < > | and leading/trailing dots or spaces.`);
  return name;
}

function notebookDir(nb: string, mustExist = true) {
  checkName(nb, "notebook name");
  if (nb.startsWith("_")) throw new UserError("Notebook names can't start with _");
  const dir = path.join(VAULT, nb);
  if (mustExist && !fs.existsSync(dir)) {
    const names = listNotebooks().map((n) => n.name);
    const hit = names.find((n) => sameName(n, nb));
    if (hit) return path.join(VAULT, hit);
    throw new UserError(`No notebook "${nb}". Existing notebooks: ${names.join(", ") || "(none)"}`);
  }
  return dir;
}

const stripExt = (name: string, ext: string) => (name.toLowerCase().endsWith(ext) ? name.slice(0, -ext.length) : name);
const notePath = (nb: string, note: string) => path.join(notebookDir(nb), `${checkName(stripExt(note, ".md"), "note name")}.md`);
const canvasPath = (nb: string, c: string) => path.join(notebookDir(nb), `${checkName(stripExt(c, ".canvas"), "canvas name")}.canvas`);

function atomicWrite(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".notely-tmp";
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function listFiles(dir: string, ext: string) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
      .map((e) => (ext === ".pdf" ? e.name : e.name.slice(0, -ext.length)))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function listNotebooks() {
  if (!fs.existsSync(VAULT)) return [];
  return fs
    .readdirSync(VAULT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
    .map((e) => {
      const dir = path.join(VAULT, e.name);
      return { name: e.name, notes: listFiles(dir, ".md"), pdfs: listFiles(path.join(dir, "_pdfs"), ".pdf"), canvases: listFiles(dir, ".canvas") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveItem(list: string[], name: string, what: string, nb: string) {
  const hit = list.find((x) => sameName(x, name));
  if (!hit) throw new UserError(`No ${what} "${name}" in "${nb}". Available: ${list.slice(0, 50).join(", ") || "(none)"}`);
  return hit;
}

function readAllNotes(nb: string): Record<string, string> {
  const dir = notebookDir(nb);
  const out: Record<string, string> = {};
  for (const n of listFiles(dir, ".md")) out[n] = fs.readFileSync(path.join(dir, `${n}.md`), "utf8");
  return out;
}

function readCanvasFile(nb: string, name: string): CanvasData {
  const file = canvasPath(nb, name);
  if (!fs.existsSync(file)) throw new UserError(`No canvas "${name}" in "${nb}".`);
  return parseCanvas(fs.readFileSync(file, "utf8")).data;
}

// ---------- pdf text ----------

async function pdfPages(nb: string, pdf: string): Promise<string[]> {
  const dir = notebookDir(nb);
  const file = path.join(dir, "_pdfs", checkName(pdf, "PDF name"));
  const modified = Math.floor(fs.statSync(file).mtimeMs);
  const cacheFile = path.join(dir, ".notely", "cache", `${pdf}.text.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (cached.modified === modified) return cached.pages;
  } catch {
    // build it
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const here = path.dirname(fileURLToPath(import.meta.url));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(here, "pdf.worker.mjs")).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: false, verbosity: 0 });
  const pages: string[] = [];
  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(buildPageText(content.items.filter((x): x is { str: string; hasEOL: boolean } => "str" in x)).text);
    }
  } finally {
    await task.destroy();
  }
  atomicWrite(cacheFile, JSON.stringify({ modified, pages }));
  return pages;
}

// ---------- server ----------

const server = new McpServer(
  { name: "notely", version: "1.0.0" },
  {
    instructions:
      `Tools for the Notely vault at ${VAULT}. Notebooks contain Markdown notes, PDFs (with highlights) and ` +
      "JSON Canvas diagrams. Link with [[Note]], [[file.pdf#page=3]], [[file.pdf#hl-id]], [[Name.canvas]]; embed diagrams with ![[Name.canvas]] " +
      "on their own line. Call get_guide once for the full format. Changes appear live in the app.",
  },
);

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>) {
  server.registerTool(name, { description, inputSchema: shape }, async (args: unknown) => {
    try {
      return ok(await run(args as z.infer<z.ZodObject<S>>));
    } catch (e) {
      const msg = e instanceof UserError ? e.message : `Unexpected error: ${(e as Error).message}`;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  });
}

const notebookArg = z.string().describe("Notebook name (top-level folder of the vault)");

tool("get_guide", "The complete Notely vault format: layout, link syntax, canvas format and conventions. Read this first.", {}, () => AGENT_GUIDE);

tool("list_notebooks", "List all notebooks with their notes, PDFs and canvases.", {}, () => ({ vault: VAULT, notebooks: listNotebooks() }));

tool("create_notebook", "Create a new, empty notebook.", { name: z.string().describe("Notebook name") }, ({ name }) => {
  const dir = notebookDir(name, false);
  if (fs.existsSync(dir)) throw new UserError(`Notebook "${name}" already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  return `Created notebook "${name}".`;
});

tool(
  "read_note",
  "Read a note's Markdown, plus the links it makes and the notes linking to it.",
  { notebook: notebookArg, note: z.string().describe("Note name (without .md)") },
  ({ notebook, note }) => {
    const all = readAllNotes(notebook);
    const name = resolveItem(Object.keys(all), stripExt(note, ".md"), "note", notebook);
    const text = all[name];
    const backlinks = Object.entries(all)
      .filter(([n, t]) => n !== name && parseLinks(t).some((l) => sameName(l.target, name)))
      .map(([n]) => n);
    return { note: name, content: text, links: parseLinks(text).map((l) => l.raw), backlinks };
  },
);

tool(
  "write_note",
  "Create or update a note. Use [[links]] to connect it to other notes, PDFs and canvases. mode: 'create' (fails if it exists), 'overwrite', or 'append'.",
  {
    notebook: notebookArg,
    note: z.string().describe("Note name (becomes the file name and title)"),
    content: z.string().describe("Markdown content"),
    mode: z.enum(["create", "overwrite", "append"]).default("create"),
  },
  ({ notebook, note, content, mode }) => {
    const file = notePath(notebook, note);
    const exists = fs.existsSync(file);
    if (mode === "create" && exists) throw new UserError(`Note "${note}" already exists — use mode "overwrite" or "append".`);
    if (mode === "append" && exists) {
      const prev = fs.readFileSync(file, "utf8");
      atomicWrite(file, prev + (prev.endsWith("\n") || !prev ? "" : "\n") + (prev.trim() ? "\n" : "") + content);
    } else atomicWrite(file, content);
    const notes = listFiles(notebookDir(notebook), ".md");
    const missing = parseLinks(content)
      .filter((l) => l.kind === "note" && !notes.some((n) => sameName(n, l.target)))
      .map((l) => l.target);
    return {
      saved: path.basename(file, ".md"),
      mode: exists ? (mode === "append" ? "appended" : "overwritten") : "created",
      ...(missing.length ? { note: `Links to notes that don't exist yet (they'll be created when clicked): ${[...new Set(missing)].join(", ")}` } : {}),
    };
  },
);

tool(
  "rename_note",
  "Rename a note and rewrite every link to it (in notes and canvas cards) across the notebook.",
  { notebook: notebookArg, old_name: z.string(), new_name: z.string() },
  ({ notebook, old_name, new_name }) => {
    const all = readAllNotes(notebook);
    const old = resolveItem(Object.keys(all), stripExt(old_name, ".md"), "note", notebook);
    const next = checkName(stripExt(new_name, ".md"), "note name");
    const to = notePath(notebook, next);
    if (fs.existsSync(to) && !sameName(old, next)) throw new UserError(`A note named "${next}" already exists.`);
    fs.renameSync(notePath(notebook, old), to);
    let changed = 0;
    for (const [n, text] of Object.entries(all)) {
      const updated = rewriteLinks(text, old, next);
      if (updated !== text) {
        atomicWrite(notePath(notebook, n === old ? next : n), updated);
        changed++;
      }
    }
    const nbName = path.basename(notebookDir(notebook));
    for (const c of listFiles(notebookDir(notebook), ".canvas")) {
      const data = readCanvasFile(notebook, c);
      let touched = false;
      for (const node of data.nodes) {
        if (node.type !== "file") continue;
        const t = fileNodeTarget(node.file, nbName);
        if (t?.kind === "note" && sameName(t.name, old)) {
          node.file = fileNodePath(nbName, "note", next);
          touched = true;
        }
      }
      if (touched) atomicWrite(canvasPath(notebook, c), serializeCanvas(data));
    }
    // Links from other notebooks use the "Notebook/Note" form.
    for (const other of listNotebooks()) {
      if (sameName(other.name, nbName)) continue;
      for (const n of other.notes) {
        const f = path.join(VAULT, other.name, `${n}.md`);
        const text = fs.readFileSync(f, "utf8");
        const updated = rewriteLinks(text, `${nbName}/${old}`, `${nbName}/${next}`);
        if (updated !== text) {
          atomicWrite(f, updated);
          changed++;
        }
      }
    }
    return `Renamed "${old}" → "${next}"; updated links in ${changed} note(s).`;
  },
);

tool(
  "search",
  "Full-text search across notes, canvases and (already indexed or small) PDFs. Returns matches with context.",
  { query: z.string(), notebook: notebookArg.optional().describe("Limit to one notebook (default: all)"), include_pdfs: z.boolean().default(true) },
  async ({ query, notebook, include_pdfs }) => {
    const books = notebook ? [path.basename(notebookDir(notebook))] : listNotebooks().map((n) => n.name);
    const results: unknown[] = [];
    for (const nb of books) {
      for (const [note, text] of Object.entries(readAllNotes(nb))) {
        const m = findInPages([text], query, 5);
        if (m.length || note.toLowerCase().includes(query.toLowerCase()))
          results.push({ notebook: nb, note, matches: m.map((x) => snippet(text, x.start, x.end, 80)).map((s) => s.before + s.match + s.after) });
      }
      for (const c of listFiles(path.join(VAULT, nb), ".canvas")) {
        try {
          const text = canvasText(readCanvasFile(nb, c));
          const m = findInPages([text], query, 5);
          if (m.length) results.push({ notebook: nb, canvas: c, matches: m.map((x) => text.slice(Math.max(0, x.start - 60), x.end + 60)) });
        } catch {
          // unreadable canvas
        }
      }
      if (!include_pdfs) continue;
      for (const pdf of listFiles(path.join(VAULT, nb, "_pdfs"), ".pdf")) {
        const pages = await pdfPages(nb, pdf).catch(() => null);
        if (!pages) continue;
        const m = findInPages(pages, query, 8);
        if (m.length)
          results.push({
            notebook: nb,
            pdf,
            matches: m.map((x) => {
              const s = snippet(pages[x.page - 1], x.start, x.end, 80);
              return { page: x.page, link: formatLink(pdf, `page=${x.page}`), text: s.before + s.match + s.after };
            }),
          });
      }
    }
    return results.length ? results : `No matches for "${query}".`;
  },
);

tool(
  "import_pdf",
  "Copy a PDF from anywhere on disk into a notebook. Returns the name to link to.",
  { notebook: notebookArg, source_path: z.string().describe("Absolute path to a .pdf file") },
  ({ notebook, source_path }) => {
    if (!source_path.toLowerCase().endsWith(".pdf") || !fs.existsSync(source_path)) throw new UserError("source_path must be an existing .pdf file.");
    const dir = path.join(notebookDir(notebook), "_pdfs");
    fs.mkdirSync(dir, { recursive: true });
    const stem = path.basename(source_path, path.extname(source_path)).trim().replace(/^\.+|\.+$/g, "") || "Document";
    let name = `${stem}.pdf`;
    for (let i = 1; fs.existsSync(path.join(dir, name)); i++) name = `${stem} ${i}.pdf`;
    fs.copyFileSync(source_path, path.join(dir, checkName(name, "PDF name")));
    return { imported: name, link: formatLink(name) };
  },
);

tool(
  "read_pdf",
  "Read the text of a PDF in a notebook, page by page (use page ranges for long books). Cite pages with [[file.pdf#page=N]].",
  {
    notebook: notebookArg,
    pdf: z.string().describe("PDF file name, e.g. paper.pdf"),
    from_page: z.number().int().min(1).default(1),
    to_page: z.number().int().min(1).optional().describe("Default: from_page + 9"),
  },
  async ({ notebook, pdf, from_page, to_page }) => {
    const name = resolveItem(listFiles(path.join(notebookDir(notebook), "_pdfs"), ".pdf"), pdf.toLowerCase().endsWith(".pdf") ? pdf : `${pdf}.pdf`, "PDF", notebook);
    const pages = await pdfPages(path.basename(notebookDir(notebook)), name);
    const end = Math.min(pages.length, to_page ?? from_page + 9);
    return {
      pdf: name,
      total_pages: pages.length,
      pages: pages.slice(from_page - 1, end).map((text, i) => ({ page: from_page + i, link: formatLink(name, `page=${from_page + i}`), text })),
    };
  },
);

tool(
  "list_highlights",
  "List the passages the user highlighted in a PDF (with their comments) and their named bookmarks, each with a ready-to-paste link.",
  { notebook: notebookArg, pdf: z.string() },
  ({ notebook, pdf }) => {
    const dir = notebookDir(notebook);
    const name = resolveItem(listFiles(path.join(dir, "_pdfs"), ".pdf"), pdf.toLowerCase().endsWith(".pdf") ? pdf : `${pdf}.pdf`, "PDF", notebook);
    const file = path.join(dir, ".notely", "highlights", `${name}.json`);
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = (data.highlights ?? []) as { id: string; page: number; text: string; color: string; comment?: string }[];
    const bookmarks = (data.bookmarks ?? []) as { id: string; page: number; name: string }[];
    return {
      highlights: list.map((h) => ({ id: h.id, page: h.page, color: h.color, text: h.text, ...(h.comment ? { comment: h.comment } : {}), link: formatLink(name, h.id) })),
      bookmarks: bookmarks.map((b) => ({ id: b.id, page: b.page, name: b.name, link: formatLink(name, b.id) })),
    };
  },
);

tool(
  "list_tags",
  "List the #tags used in notes and canvases, with the items that use each. Reuse these instead of inventing near-duplicates.",
  { notebook: notebookArg.optional().describe("Limit to one notebook (default: all)") },
  ({ notebook }) => {
    const books = notebook ? [path.basename(notebookDir(notebook))] : listNotebooks().map((n) => n.name);
    const index = new Map<string, { tag: string; items: string[] }>();
    const add = (text: string, item: string) => {
      for (const [key, tag] of tagsIn(text)) {
        const e = index.get(key) ?? { tag, items: [] };
        e.items.push(item);
        index.set(key, e);
      }
    };
    for (const nb of books) {
      for (const [n, text] of Object.entries(readAllNotes(nb))) add(text, `${nb}/${n}`);
      for (const c of listFiles(path.join(VAULT, nb), ".canvas")) {
        try {
          add(canvasText(readCanvasFile(nb, c)), `${nb}/${c}.canvas`);
        } catch {
          // unreadable canvas
        }
      }
    }
    return [...index.values()].sort((a, b) => b.items.length - a.items.length);
  },
);

// ----- canvases -----

const nodeSchema = z
  .object({
    id: z.string().describe("Unique id, used by edges"),
    text: z.string().optional().describe("Markdown text (for text nodes)"),
    shape: z.enum(["rounded", "rectangle", "ellipse", "diamond"]).optional().describe("ellipse = start/end, diamond = decision"),
    color: z.string().optional().describe('"1" red, "2" orange, "3" yellow, "4" green, "5" cyan, "6" purple, or "#rrggbb"'),
    file: z.string().optional().describe("Make this a card for a note/PDF/canvas: 'Note name.md', '_pdfs/x.pdf' or 'Other.canvas'"),
    group: z.string().optional().describe("Make this a group box with this label (place members inside via x/y)"),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  color: z.string().optional(),
  both_ways: z.boolean().optional().describe("Arrowheads on both ends"),
  no_arrow: z.boolean().optional(),
});

function toCanvasInput(nb: string, nodes: z.infer<typeof nodeSchema>[], edges: z.infer<typeof edgeSchema>[]) {
  return {
    nodes: nodes.map((n) => {
      const pos = { x: n.x, y: n.y, width: n.width, height: n.height };
      if (n.group !== undefined) return { id: n.id, type: "group", label: n.group, color: n.color, ...pos };
      if (n.file) {
        const f = n.file.replace(/\\/g, "/");
        const kind = f.toLowerCase().endsWith(".pdf") ? "pdf" : f.toLowerCase().endsWith(".canvas") ? "canvas" : "note";
        const base = path.posix.basename(f);
        const name = kind === "note" ? stripExt(base, ".md") : kind === "canvas" ? stripExt(base, ".canvas") : base;
        return { id: n.id, type: "file", file: fileNodePath(nb, kind, name), color: n.color, width: n.width ?? (kind === "note" ? 300 : 260), height: n.height ?? (kind === "note" ? 200 : 90), x: n.x, y: n.y };
      }
      return { id: n.id, type: "text", text: n.text ?? "", shape: n.shape, color: n.color, ...pos };
    }),
    edges: edges.map((e) => ({
      fromNode: e.from,
      toNode: e.to,
      label: e.label,
      color: e.color,
      fromEnd: e.both_ways ? "arrow" : "none",
      toEnd: e.no_arrow ? "none" : "arrow",
    })),
  };
}

function layoutNew(raw: unknown, direction: Direction, keepExisting?: CanvasData) {
  const { data, unplaced } = normalizeCanvas(raw);
  const merged: CanvasData = keepExisting ? { nodes: [...keepExisting.nodes, ...data.nodes], edges: [...keepExisting.edges, ...data.edges] } : data;
  return unplaced.size ? autoLayout(merged, { direction, only: unplaced }) : merged;
}

tool(
  "create_canvas",
  "Create a diagram/flowchart canvas from nodes and edges. Positions are optional: omitted ones are laid out automatically as a flowchart. Embed it in a note with ![[Name.canvas]].",
  {
    notebook: notebookArg,
    name: z.string().describe("Canvas name (without .canvas)"),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema).default([]),
    direction: z.enum(["TB", "LR"]).default("TB").describe("Auto-layout direction: top-to-bottom or left-to-right"),
    overwrite: z.boolean().default(false),
  },
  ({ notebook, name, nodes, edges, direction, overwrite }) => {
    const nb = path.basename(notebookDir(notebook));
    const file = canvasPath(nb, name);
    if (fs.existsSync(file) && !overwrite) throw new UserError(`Canvas "${name}" exists — pass overwrite: true or use update_canvas.`);
    const ids = new Set(nodes.map((n) => n.id));
    const dangling = edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
    if (dangling.length) throw new UserError(`Edges reference unknown node ids: ${dangling.map((e) => `${e.from}→${e.to}`).join(", ")}`);
    const data = layoutNew(toCanvasInput(nb, nodes, edges), direction);
    atomicWrite(file, serializeCanvas(data));
    const base = stripExt(name, ".canvas");
    return { created: base, nodes: data.nodes.length, edges: data.edges.length, embed: `![[${base}.canvas]]`, link: `[[${base}.canvas]]` };
  },
);

tool(
  "read_canvas",
  "Read a canvas as JSON Canvas data (nodes with positions, edges).",
  { notebook: notebookArg, name: z.string() },
  ({ notebook, name }) => readCanvasFile(notebook, name),
);

tool(
  "update_canvas",
  "Edit an existing canvas: add nodes/edges (new nodes without positions are placed automatically), remove nodes/edges by id, or re-layout everything.",
  {
    notebook: notebookArg,
    name: z.string(),
    add_nodes: z.array(nodeSchema).default([]),
    add_edges: z.array(edgeSchema).default([]),
    remove_ids: z.array(z.string()).default([]).describe("Node or edge ids to remove (edges of removed nodes go too)"),
    relayout: z.enum(["none", "TB", "LR"]).default("none"),
  },
  ({ notebook, name, add_nodes, add_edges, remove_ids, relayout }) => {
    const nb = path.basename(notebookDir(notebook));
    let data = readCanvasFile(nb, name);
    const rm = new Set(remove_ids);
    data = {
      nodes: data.nodes.filter((n) => !rm.has(n.id)),
      edges: data.edges.filter((e) => !rm.has(e.id) && !rm.has(e.fromNode) && !rm.has(e.toNode)),
    };
    const existing = new Set(data.nodes.map((n) => n.id));
    const clash = add_nodes.filter((n) => existing.has(n.id));
    if (clash.length) throw new UserError(`Node ids already exist: ${clash.map((n) => n.id).join(", ")}`);
    const ids = new Set([...existing, ...add_nodes.map((n) => n.id)]);
    const dangling = add_edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
    if (dangling.length) throw new UserError(`Edges reference unknown node ids: ${dangling.map((e) => `${e.from}→${e.to}`).join(", ")}`);
    // New edges may connect existing nodes, so normalize them against the whole canvas.
    const added = normalizeCanvas({ nodes: [...data.nodes, ...toCanvasInput(nb, add_nodes, []).nodes], edges: toCanvasInput(nb, [], add_edges).edges });
    const fresh = new Set([...added.unplaced].filter((id) => !existing.has(id)));
    data = { nodes: added.data.nodes, edges: [...data.edges, ...added.data.edges] };
    if (fresh.size) data = autoLayout(data, { only: fresh, direction: relayout === "LR" ? "LR" : "TB" });
    if (relayout !== "none") data = autoLayout(data, { direction: relayout });
    atomicWrite(canvasPath(nb, name), serializeCanvas(data));
    return { updated: stripExt(name, ".canvas"), nodes: data.nodes.length, edges: data.edges.length };
  },
);

// ---------- start ----------

if (!fs.existsSync(VAULT)) fs.mkdirSync(VAULT, { recursive: true });
await server.connect(new StdioServerTransport());
console.error(`Notely MCP server ready — vault: ${VAULT}`);
