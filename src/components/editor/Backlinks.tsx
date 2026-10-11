import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { isCanvasName, isPdfName, lineContext, LinkKind, parseLinks, sameName } from "../../lib/links";
import { openIn } from "../../lib/navigate";
import { externalMentions, useLinkIndex } from "../../store/linkIndex";
import { useVault } from "../../store/vaultStore";
import { PaneIndex, useWorkspace } from "../../store/workspaceStore";

export interface Backlink {
  note: string;
  /** Set when the linking note lives in another notebook. */
  notebook: string | null;
  /** The line containing the first matching link, with links rendered as text. */
  context: string;
}

const kindOf = (name: string): LinkKind => (isPdfName(name) ? "pdf" : isCanvasName(name) ? "canvas" : "note");

/** Notes linking to `target` (an item of the active notebook): local ones first, then other notebooks'. */
export function useBacklinks(target: string, self?: string): Backlink[] {
  const contents = useVault((s) => s.contents);
  const active = useVault((s) => s.activeNotebook);
  const index = useLinkIndex((s) => s.notes);
  return useMemo(() => {
    const out: Backlink[] = [];
    const kind = kindOf(target);
    for (const [note, text] of Object.entries(contents)) {
      if (self && sameName(note, self)) continue;
      const link = parseLinks(text).find(
        (l) => l.kind === kind && sameName(l.name, target) && (!l.notebook || (active && sameName(l.notebook, active))),
      );
      if (link) out.push({ note, notebook: null, context: lineContext(text, link) });
    }
    out.sort((a, b) => a.note.localeCompare(b.note));
    if (!active) return out;
    const seen = new Set<string>();
    const external: Backlink[] = [];
    for (const m of externalMentions(index, active, { name: target, kind })) {
      const k = `${m.notebook}/${m.note}`;
      if (seen.has(k)) continue;
      seen.add(k);
      external.push({ note: m.note, notebook: m.notebook, context: m.link.context });
    }
    external.sort((a, b) => a.notebook!.localeCompare(b.notebook!) || a.note.localeCompare(b.note));
    return [...out, ...external];
  }, [contents, active, index, target, self]);
}

/** Opens a backlink's note; ones from another notebook switch to it. */
export function openBacklink(b: Backlink, opts: { pane?: PaneIndex; side?: boolean }) {
  if (b.notebook) return void openIn(b.notebook, { kind: "note", name: b.note }, opts);
  useWorkspace.getState().open({ kind: "note", name: b.note }, opts);
}

export function Backlinks({ target, self, pane }: { target: string; self?: string; pane: PaneIndex }) {
  const links = useBacklinks(target, self);
  const [open, setOpen] = useState(true);
  if (links.length === 0) return null;

  return (
    <div className="mx-auto max-w-[720px] px-12 pb-16">
      <div className="border-t border-line pt-4">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[11.5px] font-medium tracking-wide text-faint uppercase hover:text-muted"
        >
          <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          {links.length} linked mention{links.length === 1 ? "" : "s"}
        </button>
        {open && (
          <ul className="mt-2 space-y-0.5">
            {links.map((b) => (
              <li key={`${b.notebook ?? ""}/${b.note}`}>
                <button
                  onClick={(e) => openBacklink(b, e.ctrlKey ? { side: true } : { pane })}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <div className="text-[13px] font-medium text-ink">
                    {b.notebook && <span className="font-normal text-faint">{b.notebook} › </span>}
                    {b.note}
                  </div>
                  {b.context && <div className="truncate text-[12.5px] text-muted">{b.context}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
