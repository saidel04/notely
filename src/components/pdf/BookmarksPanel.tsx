import { Bookmark as BookmarkIcon, ChevronRight, Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatLink } from "../../lib/links";
import { Bookmark, hlKey, useHighlights } from "../../store/highlightStore";
import { useUi } from "../../store/uiStore";
import { PDFDocumentProxy } from "./pdfjs";

interface OutlineItem {
  title: string;
  page: number | null;
  items: OutlineItem[];
}

/** Resolves pdf.js outline entries to page numbers. */
async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  const raw = await doc.getOutline();
  if (!raw) return [];
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const d = typeof dest === "string" ? await doc.getDestination(dest) : (dest as unknown[] | null);
      if (!d || !d[0]) return null;
      const ref = d[0];
      return typeof ref === "number" ? ref + 1 : (await doc.getPageIndex(ref as never)) + 1;
    } catch {
      return null;
    }
  };
  const walk = async (items: { title: string; dest: unknown; items: unknown[] }[]): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (i) => ({
        title: i.title,
        page: await resolve(i.dest),
        items: await walk((i.items ?? []) as { title: string; dest: unknown; items: unknown[] }[]),
      })),
    );
  return walk(raw as never);
}

export function BookmarksPanel({
  notebook,
  pdf,
  doc,
  editingId,
  onEditDone,
  onAdd,
  onGo,
}: {
  notebook: string;
  pdf: string;
  doc: PDFDocumentProxy;
  editingId: string | null;
  onEditDone: () => void;
  onAdd: () => void;
  onGo: (page: number, y?: number) => void;
}) {
  const bookmarks = useHighlights((s) => s.bookmarks[hlKey(notebook, pdf)]) ?? [];
  const api = useHighlights.getState();
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    void api.ensureBookmarks(notebook, pdf);
  }, [notebook, pdf, api]);
  useEffect(() => {
    void loadOutline(doc).then(setOutline).catch(() => setOutline([]));
  }, [doc]);
  useEffect(() => {
    if (editingId) setRenaming(editingId);
  }, [editingId]);

  const copyLink = (b: Bookmark) => {
    void navigator.clipboard.writeText(formatLink(pdf, b.id));
    useUi.getState().toast("Bookmark link copied — paste it into a note, or onto selected words");
  };

  return (
    <>
      <div className="flex items-center justify-between px-2 pt-1 pb-1">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Your bookmarks</span>
        <button onClick={onAdd} title="Bookmark this spot (Ctrl+B)" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-ink">
          <Plus size={13} /> Add
        </button>
      </div>
      {bookmarks.length === 0 && <div className="px-2.5 pb-3 text-[12.5px] leading-relaxed text-faint">Bookmark a spot to come back to it, or to link to it from a note.</div>}
      {bookmarks.map((b) =>
        renaming === b.id ? (
          <input
            key={b.id}
            autoFocus
            defaultValue={b.name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name) api.updateBookmark(notebook, pdf, b.id, { name });
              setRenaming(null);
              onEditDone();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
            className="mb-0.5 w-full rounded-md border border-accent bg-bg px-2 py-1.5 text-[12.5px] text-ink outline-none"
          />
        ) : (
          <div key={b.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
            <BookmarkIcon size={13} className="shrink-0 text-accent" />
            <button onClick={() => onGo(b.page, b.y)} onDoubleClick={() => setRenaming(b.id)} className="min-w-0 flex-1 text-left" title="Click to go · double-click to rename">
              <span className="block truncate text-[12.5px] text-ink">{b.name}</span>
              <span className="text-[11px] text-faint">Page {b.page}</span>
            </button>
            <span className="hidden items-center group-hover:flex">
              <button title="Copy link" onClick={() => copyLink(b)} className="rounded p-1 text-faint hover:text-ink">
                <Link2 size={13} />
              </button>
              <button title="Delete" onClick={() => api.removeBookmark(notebook, pdf, b.id)} className="rounded p-1 text-faint hover:text-danger">
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ),
      )}

      {outline && outline.length > 0 && (
        <>
          <div className="mx-2 my-2 h-px bg-line" />
          <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Contents</div>
          <Outline items={outline} depth={0} onGo={onGo} />
        </>
      )}
    </>
  );
}

function Outline({ items, depth, onGo }: { items: OutlineItem[]; depth: number; onGo: (page: number) => void }) {
  return (
    <>
      {items.map((it, i) => (
        <OutlineRow key={i} item={it} depth={depth} onGo={onGo} />
      ))}
    </>
  );
}

function OutlineRow({ item, depth, onGo }: { item: OutlineItem; depth: number; onGo: (page: number) => void }) {
  const [open, setOpen] = useState(depth === 0 && item.items.length < 12);
  return (
    <>
      <div className="flex items-center rounded-md hover:bg-hover" style={{ paddingLeft: 4 + depth * 12 }}>
        {item.items.length ? (
          <button onClick={() => setOpen(!open)} className="p-1 text-faint hover:text-ink">
            <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button disabled={!item.page} onClick={() => item.page && onGo(item.page)} className="flex min-w-0 flex-1 items-baseline gap-2 py-1 pr-2 text-left">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{item.title}</span>
          {item.page && <span className="shrink-0 text-[11px] text-faint tabular-nums">{item.page}</span>}
        </button>
      </div>
      {open && item.items.length > 0 && <Outline items={item.items} depth={depth + 1} onGo={onGo} />}
    </>
  );
}
