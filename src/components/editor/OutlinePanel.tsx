import { EditorView } from "@codemirror/view";
import { ListTree, X } from "lucide-react";
import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import { editors } from "../../lib/editorRegistry";
import { outline } from "../../lib/outline";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { PaneIndex } from "../../store/workspaceStore";

/**
 * A note's headings, floating at the pane's top-right. The heading at the top
 * of the view is marked as you scroll; clicking one jumps there.
 */
export function OutlinePanel({ note, pane, scroller }: { note: string; pane: PaneIndex; scroller: RefObject<HTMLDivElement | null> }) {
  // Subscribed here (not in the editor) so typing only re-renders this panel.
  const text = useVault((s) => s.contents[note] ?? "");
  const headings = useMemo(() => outline(text), [text]);
  const [active, setActive] = useState(-1);
  /** Until this time, scroll events come from a click-to-jump; keep the clicked heading marked. */
  const jumpedUntil = useRef(0);
  const minLevel = Math.min(...headings.map((h) => h.level));

  useEffect(() => {
    const el = scroller.current;
    const view = editors.get(pane);
    if (!el || !view) return;
    const update = () => {
      if (Date.now() < jumpedUntil.current) return;
      const box = el.getBoundingClientRect();
      // At the very end the last headings can't scroll up to the top, so mark
      // the last one that's on screen instead.
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && el.scrollTop > 0;
      const line = atBottom ? box.bottom - 40 : box.top + 96;
      let i = -1;
      for (let k = 0; k < headings.length; k++) {
        const pos = Math.min(headings[k].from, view.state.doc.length);
        if (view.documentTop + view.lineBlockAt(pos).top <= line) i = k;
        else break;
      }
      setActive(i);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [headings, pane, scroller]);

  const jump = (index: number, from: number) => {
    const view = editors.get(pane);
    if (!view) return;
    setActive(index);
    jumpedUntil.current = Date.now() + 500;
    const pos = Math.min(from, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 48 }) });
    view.focus();
  };

  return (
    <nav
      aria-label="Note outline"
      className="note-outline animate-pop absolute top-3 right-3 z-20 flex max-h-[calc(100%-24px)] w-[230px] flex-col rounded-xl border border-line bg-surface/95 shadow-pop backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ListTree size={13} className="text-faint" aria-hidden="true" />
        <span className="flex-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">Outline</span>
        <button
          onClick={() => useUi.getState().toggleOutline()}
          aria-label="Hide outline"
          title="Hide outline (Ctrl+Shift+O)"
          className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>
      <div className="overflow-y-auto p-1.5">
        {headings.length === 0 ? (
          <div className="px-2 py-2 text-[12.5px] leading-relaxed text-faint">
            No headings yet. Start a line with <span className="rounded bg-hover px-1 font-mono">#</span> to add one.
          </div>
        ) : (
          <ul>
            {headings.map((h, i) => (
              <li key={`${h.from}:${h.text}`}>
                <button
                  onClick={() => jump(i, h.from)}
                  aria-current={i === active ? "location" : undefined}
                  className={`block w-full truncate rounded-md py-1 pr-2 text-left text-[12.5px] transition-colors hover:bg-hover hover:text-ink ${
                    i === active ? "bg-active font-medium text-ink" : h.level === minLevel ? "text-ink" : "text-muted"
                  }`}
                  style={{ paddingLeft: 8 + (h.level - minLevel) * 12 }}
                  title={h.text}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
