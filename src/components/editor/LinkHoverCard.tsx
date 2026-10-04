import { BookOpen, Bookmark as BookmarkIcon, FileText } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canvasBase, displayText, parseLinks, WikiLink } from "../../lib/links";
import { renderMarkdown } from "../../lib/markdown";
import { resolveRef } from "../../lib/navigate";
import { vaultApi } from "../../lib/vault";
import { hlKey, useHighlights } from "../../store/highlightStore";
import { useVault } from "../../store/vaultStore";
import { CanvasPreview } from "../canvas/CanvasPreview";

/** Small preview of what a link points to, shown while hovering it. */
export function LinkHoverCard({ link, rect, notebook }: { link: WikiLink; rect: DOMRect; notebook: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 8 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const below = rect.bottom + 8 + height < window.innerHeight - 8;
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: below ? rect.bottom + 8 : Math.max(8, rect.top - height - 8),
    });
  }, [rect]);

  return createPortal(
    <div ref={ref} className="animate-fade pointer-events-none fixed z-50 w-[340px] rounded-xl border border-line bg-surface p-3.5 shadow-pop" style={pos}>
      <Body link={link} notebook={notebook} />
    </div>,
    document.body,
  );
}

function Body({ link, notebook }: { link: WikiLink; notebook: string }) {
  const contents = useVault((s) => s.contents);
  const ref = resolveRef(link.target, link.kind);
  const nb = ref?.notebook ?? notebook;
  const pdf = link.kind === "pdf" ? (ref?.name ?? null) : null;
  const highlights = useHighlights((s) => (pdf ? s.byPdf[hlKey(nb, pdf)] : undefined));
  const bookmarks = useHighlights((s) => (pdf ? s.bookmarks[hlKey(nb, pdf)] : undefined));
  // Notes in other notebooks aren't loaded; read them on demand.
  const [remote, setRemote] = useState<string | null>(null);
  useEffect(() => {
    if (pdf && (link.highlightId || link.bookmarkId)) void useHighlights.getState().ensure(nb, pdf);
    if (ref && !ref.local && ref.kind === "note") void vaultApi.readNote(ref.notebook, ref.name).then(setRemote).catch(() => setRemote(""));
  }, [pdf, link.highlightId, link.bookmarkId, nb, ref?.name, ref?.local]); // eslint-disable-line react-hooks/exhaustive-deps
  const where = ref && !ref.local ? `${ref.notebook} › ` : "";

  if (link.kind === "note") {
    if (!ref) return <Missing what="note" name={link.name} />;
    const name = ref.name;
    const body = ((ref.local ? contents[name] : remote) ?? "").trim();
    // Links in the excerpt read as plain text.
    const readable = parseLinks(body)
      .reverse()
      .reduce((s, l) => s.slice(0, l.from) + displayText(l) + s.slice(l.to), body);
    return (
      <>
        <Title icon={<FileText size={13} />} text={where + name} />
        {readable ? (
          <div className="hover-excerpt max-h-[180px] overflow-hidden font-serif text-[13px] leading-relaxed text-muted" dangerouslySetInnerHTML={{ __html: renderMarkdown(readable.slice(0, 700)) }} />
        ) : (
          <div className="text-[12.5px] text-faint italic">Empty note</div>
        )}
      </>
    );
  }

  if (link.kind === "canvas") {
    if (!ref) return <Missing what="canvas" name={canvasBase(link.name)} />;
    return <CanvasPreview notebook={notebook} name={ref.name} height={190} onOpen={() => {}} elsewhere={ref.local ? null : ref.notebook} />;
  }

  if (!pdf) return <Missing what="PDF" name={link.name} />;
  const title = where + pdf.replace(/\.pdf$/i, "");
  if (link.highlightId) {
    const h = highlights?.find((x) => x.id === link.highlightId);
    if (!highlights) return <Title icon={<BookOpen size={13} />} text={title} />;
    if (!h) return <Missing what="highlight" name={`in ${title}`} />;
    return (
      <>
        <div className={`mb-2.5 border-l-[3px] pl-3 font-serif text-[14px] leading-relaxed text-ink italic hl-border-${h.color}`}>“{h.text}”</div>
        {h.comment && <div className="mb-2.5 rounded-md bg-hover px-2.5 py-1.5 text-[12.5px] leading-snug text-muted">{h.comment}</div>}
        <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
          <BookOpen size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{title}</span>
          <span className="shrink-0 whitespace-nowrap">· p. {h.page}</span>
        </div>
      </>
    );
  }
  if (link.bookmarkId) {
    const b = bookmarks?.find((x) => x.id === link.bookmarkId);
    if (bookmarks && !b) return <Missing what="bookmark" name={`in ${title}`} />;
    return (
      <>
        <Title icon={<BookmarkIcon size={13} />} text={b?.name ?? "Bookmark"} />
        <div className="truncate text-[12.5px] text-muted">
          {title}
          {b ? ` · page ${b.page}` : ""}
        </div>
      </>
    );
  }
  return (
    <>
      <Title icon={<BookOpen size={13} />} text={title} />
      <div className="text-[12.5px] text-muted">{link.page ? `Page ${link.page}` : "PDF"}</div>
    </>
  );
}

function Title({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
      <span className="text-accent">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  );
}

function Missing({ what, name }: { what: string; name: string }) {
  return (
    <div className="text-[12.5px] text-muted">
      No {what} “{name}” yet{what === "note" || what === "canvas" ? " — click to create it" : ""}.
    </div>
  );
}
