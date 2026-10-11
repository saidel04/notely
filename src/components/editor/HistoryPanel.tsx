import { History, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { diffLines, diffStats, foldUnchanged } from "../../lib/diff";
import { editors } from "../../lib/editorRegistry";
import { errorMessage, vaultApi } from "../../lib/vault";
import { useUi } from "../../store/uiStore";
import { noteSaver, useVault } from "../../store/vaultStore";
import { useWorkspace } from "../../store/workspaceStore";

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Earlier versions of a note, compared with the current text, with restore. */
export default function HistoryPanel() {
  const note = useUi((s) => s.history?.note ?? "");
  const notebook = useVault((s) => s.activeNotebook) ?? "";
  const current = useVault((s) => s.contents[note] ?? "");
  const [versions, setVersions] = useState<{ time: number; size: number }[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<"changes" | "version">("changes");
  const close = () => useUi.setState({ history: null });

  useEffect(() => {
    void vaultApi
      .listVersions(notebook, note)
      .then((v) => {
        setVersions(v);
        setPicked(v[0]?.time ?? null);
      })
      .catch(() => setVersions([]));
  }, [notebook, note]);

  useEffect(() => {
    setText(null);
    if (picked !== null) void vaultApi.readVersion(notebook, note, picked).then(setText).catch(() => setText(""));
  }, [picked, notebook, note]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // From the version to now: green is what you've added since, red what's gone.
  const diff = useMemo(() => (text === null ? null : diffLines(text, current)), [text, current]);
  const stats = diff ? diffStats(diff) : null;

  const restore = async () => {
    if (text === null || picked === null) return;
    try {
      await noteSaver.flushAll();
      await vaultApi.snapshotNote(notebook, note); // so this restore can itself be undone
      const ws = useWorkspace.getState();
      const pane = ws.panes.findIndex((p) => p?.kind === "note" && p.name === note);
      const view = pane === -1 ? undefined : editors.get(pane as 0 | 1);
      if (view) {
        // Through the editor, so Ctrl+Z works too.
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.restore" });
      } else {
        await vaultApi.writeNote(notebook, note, text);
        useVault.setState((s) => ({ contents: { ...s.contents, [note]: text } }));
      }
      useUi.getState().toast(`Restored the version from ${fmt.format(picked)}`);
      close();
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[7vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={`Version history of ${note}`} className="animate-pop flex h-[80vh] w-[min(980px,92vw)] flex-col rounded-xl border border-line bg-surface shadow-pop">
        <header className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <History size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">Version history</div>
            <div className="truncate text-[12px] text-faint">{note}</div>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-md p-1 text-faint hover:bg-hover hover:text-ink">
            <X size={16} />
          </button>
        </header>

        {versions === null ? (
          <div className="flex flex-1 items-center justify-center text-faint">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="mb-1.5 text-[15px] font-medium text-ink">No earlier versions yet</div>
            <div className="max-w-sm text-[13px] leading-relaxed text-muted">
              Notely keeps a version of this note each time you come back to edit it, and every 10 minutes while you write.
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ul role="listbox" aria-label="Versions" className="w-[230px] shrink-0 overflow-y-auto border-r border-line p-1.5">
              {versions.map((v) => (
                <li key={v.time}>
                  <button
                    role="option"
                    aria-selected={picked === v.time}
                    onClick={() => setPicked(v.time)}
                    className={`w-full rounded-md px-2.5 py-2 text-left ${picked === v.time ? "bg-active" : "hover:bg-hover"}`}
                  >
                    <div className="text-[13px] text-ink">{fmt.format(v.time)}</div>
                    <div className="text-[11.5px] text-faint">
                      {ago(v.time)} · {v.size < 1024 ? `${v.size} B` : `${Math.round(v.size / 1024)} KB`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-3 border-b border-line px-4 py-2">
                <div className="flex rounded-md bg-hover p-0.5 text-[12px]">
                  {(["changes", "version"] as const).map((m) => (
                    <button key={m} onClick={() => setMode(m)} className={`rounded-[5px] px-2.5 py-1 ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                      {m === "changes" ? "Changes since" : "This version"}
                    </button>
                  ))}
                </div>
                {stats && mode === "changes" && (
                  <span className="text-[12px] text-faint">
                    <span className="text-[#3fb950]">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span> lines since
                  </span>
                )}
                <span className="flex-1" />
                <button
                  onClick={() => void restore()}
                  disabled={text === null || text === current}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  <RotateCcw size={13} /> Restore this version
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-2 py-3 font-mono text-[12.5px] leading-[1.6]">
                {text === null || !diff ? (
                  <Loader2 className="m-4 animate-spin text-faint" size={18} />
                ) : mode === "version" ? (
                  <pre className="px-3 whitespace-pre-wrap text-ink">{text || "(empty)"}</pre>
                ) : text === current ? (
                  <div className="px-3 text-faint">Same as the note is now.</div>
                ) : (
                  foldUnchanged(diff, 2).map((l, i) =>
                    l.op === "skip" ? (
                      <div key={i} className="my-1 px-3 text-[11.5px] text-faint">
                        ⋯ {l.count} unchanged line{l.count === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <div
                        key={i}
                        className={`px-3 whitespace-pre-wrap ${l.op === "add" ? "bg-[#3fb950]/12 text-ink" : l.op === "del" ? "bg-danger/10 text-muted line-through decoration-danger/40" : "text-muted"}`}
                      >
                        <span className="mr-2 inline-block w-3 text-faint select-none">{l.op === "add" ? "+" : l.op === "del" ? "−" : ""}</span>
                        {l.text || " "}
                      </div>
                    ),
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
