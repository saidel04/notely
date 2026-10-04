import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { displayText, parseLinks, sameName } from "../../lib/links";
import { useVault } from "../../store/vaultStore";
import { PaneIndex, useWorkspace } from "../../store/workspaceStore";

export interface Backlink {
  note: string;
  /** The line containing the first matching link, with links rendered as text. */
  context: string;
}

export function useBacklinks(target: string, self?: string): Backlink[] {
  const contents = useVault((s) => s.contents);
  return useMemo(() => {
    const out: Backlink[] = [];
    for (const [note, text] of Object.entries(contents)) {
      if (self && sameName(note, self)) continue;
      const link = parseLinks(text).find((l) => sameName(l.target, target));
      if (!link) continue;
      const start = text.lastIndexOf("\n", link.from) + 1;
      const endIdx = text.indexOf("\n", link.to);
      const raw = text.slice(start, endIdx === -1 ? undefined : endIdx);
      const context = parseLinks(raw)
        .reverse()
        .reduce((s, l) => s.slice(0, l.from) + displayText(l) + s.slice(l.to), raw)
        .replace(/^\s*(#+|[-*>]|\d+\.)\s+/, "")
        .trim();
      out.push({ note, context });
    }
    return out.sort((a, b) => a.note.localeCompare(b.note));
  }, [contents, target, self]);
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
              <li key={b.note}>
                <button
                  onClick={(e) =>
                    useWorkspace
                      .getState()
                      .open({ kind: "note", name: b.note }, e.ctrlKey ? { side: true } : { pane })
                  }
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <div className="text-[13px] font-medium text-ink">{b.note}</div>
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
