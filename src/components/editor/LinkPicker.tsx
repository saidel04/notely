import { Command } from "cmdk";
import { BookOpen, Bookmark, FileText, Workflow } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collectTargets, LinkTarget } from "../../lib/linkTargets";

/**
 * Picker for "link the selected words to…": notes, highlighted quotes, PDFs, canvases.
 * Anchored under the selection.
 */
export function LinkPicker({
  notebook,
  note,
  anchor,
  selectionText,
  onPick,
  onClose,
}: {
  notebook: string;
  note: string;
  anchor: { x: number; y: number };
  selectionText: string;
  onPick: (t: LinkTarget) => void;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<LinkTarget[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  useEffect(() => {
    void collectTargets(notebook, note).then(setTargets);
  }, [notebook, note]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const top = anchor.y + height > window.innerHeight - 12 ? Math.max(12, anchor.y - height - 34) : anchor.y;
    setPos({ left: Math.max(12, Math.min(anchor.x, window.innerWidth - width - 12)), top });
  }, [anchor, targets]);

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    // Registered a tick later: the click that opened the picker must not close it.
    const t = window.setTimeout(() => window.addEventListener("mousedown", down));
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", down);
    };
  }, [onClose]);

  const groups: [string, LinkTarget["kind"]][] = [
    ["Highlighted quotes", "highlight"],
    ["Bookmarks", "bookmark"],
    ["Notes", "note"],
    ["PDFs", "pdf"],
    ["Canvases", "canvas"],
  ];

  return createPortal(
    <div ref={ref} className="animate-pop fixed z-50" style={pos}>
      <Command
        loop
        className="w-[420px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {selectionText && (
          <div className="truncate border-b border-line px-3.5 pt-2.5 pb-2 text-[11.5px] text-faint">
            Link <span className="font-medium text-ink">“{selectionText}”</span> to…
          </div>
        )}
        <Command.Input
          autoFocus
          placeholder="Search notes, quotes, PDFs, canvases…"
          className="w-full border-b border-line bg-transparent px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-faint"
        />
        <Command.List className="max-h-[320px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase">
          {targets === null ? (
            <div className="px-3 py-5 text-center text-[12.5px] text-faint">Loading…</div>
          ) : (
            <Command.Empty className="px-3 py-5 text-center text-[12.5px] text-faint">Nothing matches</Command.Empty>
          )}
          {targets &&
            groups.map(([heading, kind]) => {
              const items = targets.filter((t) => t.kind === kind);
              if (!items.length) return null;
              return (
                <Command.Group key={kind} heading={heading}>
                  {items.map((t) => (
                    <Command.Item
                      key={t.kind + t.target + (t.fragment ?? "")}
                      value={`${t.kind} ${t.target} ${t.fragment ?? ""} ${t.label}`}
                      keywords={[t.detail ?? ""]}
                      onSelect={() => onPick(t)}
                      className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink data-[selected=true]:bg-accent-soft"
                    >
                      {t.kind === "highlight" ? (
                        <span className={`mt-[3px] h-[14px] w-1 shrink-0 rounded-full hl-${t.color}`} style={{ mixBlendMode: "normal" }} />
                      ) : (
                        <span className="mt-px text-faint">
                          {t.kind === "note" ? (
                            <FileText size={14} />
                          ) : t.kind === "pdf" ? (
                            <BookOpen size={14} />
                          ) : t.kind === "bookmark" ? (
                            <Bookmark size={14} />
                          ) : (
                            <Workflow size={14} />
                          )}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={t.kind === "highlight" ? "line-clamp-2 font-serif italic" : "truncate"}>{t.label}</span>
                        {t.detail && <span className="block truncate text-[11.5px] text-faint">{t.detail}</span>}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
        </Command.List>
      </Command>
    </div>,
    document.body,
  );
}
