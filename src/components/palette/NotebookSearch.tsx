import { Command } from "cmdk";
import { BookOpen, FileText, Loader2, Search, Workflow } from "lucide-react";
import { canvasText } from "../../lib/canvas";
import { useCanvases } from "../../store/canvasStore";
import { useEffect, useMemo, useState } from "react";
import { getPdfPages } from "../../lib/pdfIndex";
import { findInPages, queryRegex, snippet } from "../../lib/pdfText";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { nextNonce, useWorkspace } from "../../store/workspaceStore";

const PER_FILE = 4;

interface Hit {
  key: string;
  before: string;
  match: string;
  after: string;
  open: () => void;
}

interface Group {
  kind: "note" | "pdf" | "canvas";
  name: string;
  total: number;
  hits: Hit[];
  openFile: () => void;
}

let lastQuery = "";

/** Makes raw Markdown around a match readable: no link brackets, ids or emphasis markers. */
function readable(s: string) {
  return s
    .replace(/\[\[|\]\]/g, "")
    .replace(/\.pdf#hl-[a-z0-9]+/gi, "")
    .replace(/\.pdf#page=(\d+)/gi, " p. $1")
    .replace(/\.pdf/gi, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)#{1,6}\s/g, "$1")
    .replace(/\s+/g, " ");
}

/** Full-text search across every note and PDF in the active notebook. */
export function NotebookSearch() {
  const open = useUi((s) => s.palette === "search");
  if (!open) return null;
  return <SearchDialog />;
}

function SearchDialog() {
  const close = () => useUi.getState().openPalette(null);
  const notebook = useVault((s) => s.notebooks.find((n) => n.name === s.activeNotebook));
  const contents = useVault((s) => s.contents);
  const [query, setQuery] = useState(lastQuery);
  const [debounced, setDebounced] = useState(lastQuery);
  const [pdfPages, setPdfPages] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 150);
    lastQuery = query;
    return () => window.clearTimeout(t);
  }, [query]);

  // Index PDFs in the background (cached on disk after the first time).
  useEffect(() => {
    if (!notebook) return;
    let cancelled = false;
    setPending(notebook.pdfs.length);
    (async () => {
      for (const p of notebook.pdfs) {
        try {
          const pages = await getPdfPages(notebook.name, p.name, p.modified);
          if (!cancelled) setPdfPages((s) => ({ ...s, [p.name]: pages }));
        } catch {
          // Unreadable PDF: skip it.
        }
        if (!cancelled) setPending((n) => n - 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notebook]);

  const groups = useMemo<Group[]>(() => {
    const re = queryRegex(debounced);
    if (!re || !notebook) return [];
    const ws = useWorkspace.getState();
    const out: Group[] = [];
    const q = debounced.trim();

    for (const n of notebook.notes) {
      const text = contents[n.name] ?? "";
      const matches = [...text.matchAll(re)].filter((m) => m[0].length);
      const titleHit = n.name.toLowerCase().includes(q.toLowerCase());
      if (!matches.length && !titleHit) continue;
      out.push({
        kind: "note",
        name: n.name,
        total: matches.length,
        openFile: () => ws.open({ kind: "note", name: n.name }),
        hits: matches.slice(0, PER_FILE).map((m) => {
          const from = m.index!;
          const to = from + m[0].length;
          const snip = snippet(text, from, to);
          return {
            key: `n:${n.name}:${from}`,
            before: readable(snip.before),
            match: snip.match,
            after: readable(snip.after),
            open: () => ws.open({ kind: "note", name: n.name, target: { from, to, nonce: nextNonce() } }),
          };
        }),
      });
    }

    const canvases = useCanvases.getState().data;
    for (const c of notebook.canvases) {
      const text = canvases[c.name] ? canvasText(canvases[c.name]) : "";
      const matches = [...text.matchAll(re)].filter((m) => m[0].length);
      if (!matches.length && !c.name.toLowerCase().includes(q.toLowerCase())) continue;
      out.push({
        kind: "canvas",
        name: c.name,
        total: matches.length,
        openFile: () => ws.open({ kind: "canvas", name: c.name }),
        hits: matches.slice(0, PER_FILE).map((m) => {
          const snip = snippet(text, m.index!, m.index! + m[0].length);
          return { key: `c:${c.name}:${m.index}`, ...snip, open: () => ws.open({ kind: "canvas", name: c.name }) };
        }),
      });
    }

    for (const p of notebook.pdfs) {
      const pages = pdfPages[p.name];
      if (!pages) continue;
      const matches = findInPages(pages, q, 500);
      if (!matches.length) continue;
      out.push({
        kind: "pdf",
        name: p.name,
        total: matches.length,
        openFile: () => ws.open({ kind: "pdf", name: p.name, target: { search: q, nonce: nextNonce() } }),
        hits: matches.slice(0, PER_FILE).map((m) => {
          const snip = snippet(pages[m.page - 1], m.start, m.end);
          return {
            key: `p:${p.name}:${m.page}:${m.start}`,
            ...snip,
            before: `p. ${m.page} · ${snip.before}`,
            open: () => ws.open({ kind: "pdf", name: p.name, target: { page: m.page, search: q, nonce: nextNonce() } }),
          };
        }),
      });
    }
    // Notes first, then by number of matches.
    const order = { note: 0, canvas: 1, pdf: 2 };
    return out.sort((a, b) => (a.kind === b.kind ? b.total - a.total : order[a.kind] - order[b.kind]));
  }, [debounced, contents, pdfPages, notebook]);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/15 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <Command
        loop
        shouldFilter={false}
        className="animate-pop flex max-h-[76vh] w-[680px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            onFocus={(e) => e.target.select()}
            placeholder={`Search everything in ${notebook?.name ?? "this notebook"}…`}
            className="w-full bg-transparent py-3.5 text-[14.5px] text-ink outline-none placeholder:text-faint"
          />
          {pending > 0 && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-faint" title="Reading PDF text">
              <Loader2 size={12} className="animate-spin" /> Indexing {pending} PDF{pending === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <Command.List className="flex-1 overflow-y-auto p-1.5">
          {debounced.trim() && groups.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] text-faint">
              {pending > 0 ? "Searching…" : "No matches in this notebook"}
            </div>
          )}
          {!debounced.trim() && (
            <div className="px-3 py-8 text-center text-[13px] text-faint">Search the text of every note and PDF</div>
          )}
          {groups.map((g) => (
            <Command.Group key={g.kind + g.name} className="mb-1">
              <Command.Item
                value={`file:${g.kind}:${g.name}`}
                onSelect={run(g.openFile)}
                className="flex items-center gap-2 rounded-md px-2.5 pt-2 pb-1 text-[12.5px] font-medium text-ink data-[selected=true]:bg-accent-soft"
              >
                <span className="text-faint">
                  {g.kind === "note" ? <FileText size={14} /> : g.kind === "canvas" ? <Workflow size={14} /> : <BookOpen size={14} />}
                </span>
                <span className="flex-1 truncate">{g.kind === "pdf" ? g.name.replace(/\.pdf$/i, "") : g.name}</span>
                {g.total > 0 && (
                  <span className="text-[11px] font-normal text-faint">
                    {g.total} match{g.total === 1 ? "" : "es"}
                  </span>
                )}
              </Command.Item>
              {g.hits.map((h) => (
                <Command.Item
                  key={h.key}
                  value={h.key}
                  onSelect={run(h.open)}
                  className="ml-6 rounded-md px-2.5 py-1.5 text-[12.5px] leading-snug text-muted data-[selected=true]:bg-accent-soft"
                >
                  <span className="line-clamp-2">
                    {h.before}
                    <mark className="rounded-sm bg-[var(--hl-yellow)] px-px text-ink">{h.match}</mark>
                    {h.after}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </Command>
    </div>
  );
}
