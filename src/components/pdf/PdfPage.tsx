import { memo, useEffect, useRef } from "react";
import { Bookmark, Highlight } from "../../store/highlightStore";
import { pdfjs, PDFDocumentProxy } from "./pdfjs";
import { SearchHit } from "./usePdfSearch";

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  scale: number;
  width: number;
  height: number;
  visible: boolean;
  highlights: Highlight[];
  flashId: string | null;
  flashPage: boolean;
  searchHits: SearchHit[];
  bookmarks: Bookmark[];
}

/** One PDF page: canvas + selectable text layer + highlight overlay. Rendered only while near the viewport. */
export const PdfPage = memo(function PdfPage({ doc, page, scale, width, height, visible, highlights, flashId, flashPage, searchHits, bookmarks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    if (!visible || !canvas || !textDiv) return;

    let cancelled = false;
    let renderTask: ReturnType<import("./pdfjs").PDFPageProxy["render"]> | null = null;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;

    // Debounce so rapid zooming doesn't queue dozens of renders.
    const timer = window.setTimeout(async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const viewport = p.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const offscreen = document.createElement("canvas");
        offscreen.width = Math.floor(viewport.width * dpr);
        offscreen.height = Math.floor(viewport.height * dpr);
        renderTask = p.render({
          canvas: offscreen,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
        if (cancelled) return;
        // Swap in the finished bitmap at once, so zooming never flashes blank pages.
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext("2d")!.drawImage(offscreen, 0, 0);

        textDiv.replaceChildren();
        textLayer = new pdfjs.TextLayer({
          textContentSource: p.streamTextContent(),
          container: textDiv,
          viewport,
        });
        await textLayer.render();
      } catch (e) {
        if (!cancelled && (e as Error)?.name !== "RenderingCancelledException") console.error(e);
      }
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [doc, page, scale, visible]);

  // Free memory when scrolled far away.
  useEffect(() => {
    if (visible) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.width = canvas.height = 0;
    textRef.current?.replaceChildren();
  }, [visible]);

  const style = {
    width,
    height,
    "--scale-factor": scale,
    "--user-unit": 1,
    "--total-scale-factor": scale,
  } as React.CSSProperties;

  return (
    <div className={`pdf-page${flashPage ? " page-flash" : ""}`} data-page={page} style={style}>
      <canvas ref={canvasRef} />
      <div className="absolute inset-0 z-[1]">
        {highlights.flatMap((h) =>
          h.rects
            .filter((r) => r.page === page)
            .map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                data-hl={h.id}
                className={`hl hl-${h.color}${flashId === h.id ? " hl-flash" : ""}`}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
              />
            )),
        )}
        {highlights
          .filter((h) => h.comment && h.rects.some((r) => r.page === page))
          .map((h) => {
            const last = [...h.rects].reverse().find((r) => r.page === page)!;
            return (
              <div
                key={`c-${h.id}`}
                className="hl-comment-dot"
                title={h.comment}
                style={{ left: `${(last.x + last.w) * 100}%`, top: `${last.y * 100}%` }}
              />
            );
          })}
        {bookmarks
          .filter((b) => b.page === page)
          .map((b) => (
            <div key={b.id} className="bm-ribbon" title={b.name} style={{ top: `${b.y * 100}%` }} />
          ))}
        {searchHits.map((s, i) => (
          <div
            key={`s${i}`}
            className={`search-hit${s.current ? " current" : ""}`}
            style={{
              left: `${s.rect.x * 100}%`,
              top: `${s.rect.y * 100}%`,
              width: `${s.rect.w * 100}%`,
              height: `${s.rect.h * 100}%`,
            }}
          />
        ))}
      </div>
      <div ref={textRef} className="textLayer" />
    </div>
  );
});
