import { Command } from "cmdk";
import { CalendarDays, FolderOpen, LayoutTemplate } from "lucide-react";
import { useEffect, useState } from "react";
import { listTemplates, templates } from "../../lib/templateActions";
import { DAILY_TEMPLATE } from "../../lib/templates";
import { useUi } from "../../store/uiStore";

/** Pick a template for a new note (palette kind "templates"). */
export function TemplatePicker() {
  const mode = useUi((s) => s.palette);
  const side = useUi((s) => s.paletteSide);
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    if (mode !== "templates") return;
    setNames(null);
    listTemplates()
      .then(setNames)
      .catch(() => setNames([]));
  }, [mode]);

  if (mode !== "templates") return null;
  const close = () => useUi.getState().openPalette(null);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/15 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <Command loop label="New note from template" className="animate-pop w-[480px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop" onKeyDown={(e) => e.key === "Escape" && close()}>
        <Command.Input
          autoFocus
          placeholder="New note from template…"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[14px] text-ink outline-none placeholder:text-faint"
        />
        <Command.List className="max-h-[340px] overflow-y-auto p-1.5">
          {names === null ? (
            <Command.Loading>
              <div className="px-3 py-2 text-[13px] text-faint">Loading templates…</div>
            </Command.Loading>
          ) : (
            <>
              <Command.Empty className="px-3 py-2 text-[13px] text-faint">No matching template</Command.Empty>
              {names.map((n) => (
                <Row key={n} value={n} icon={n === DAILY_TEMPLATE ? <CalendarDays size={15} /> : <LayoutTemplate size={15} />} onSelect={run(() => void (n === DAILY_TEMPLATE ? templates.today() : templates.newNote(n, side)))}>
                  {n}
                  {n === DAILY_TEMPLATE && <span className="ml-2 text-[11.5px] text-faint">today's note</span>}
                </Row>
              ))}
              <Row value="Open templates folder edit add" icon={<FolderOpen size={15} />} onSelect={run(() => void templates.openFolder())}>
                <span className="text-muted">Edit templates…</span>
              </Row>
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function Row({ value, icon, onSelect, children }: { value: string; icon: React.ReactNode; onSelect: () => void; children: React.ReactNode }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-ink data-[selected=true]:bg-hover"
    >
      <span className="text-faint">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </Command.Item>
  );
}
