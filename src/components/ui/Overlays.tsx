import { useEffect, useState } from "react";
import { useUi } from "../../store/uiStore";

/** Minimal text prompt driven by `useUi().ask()`. */
export function PromptDialog() {
  const prompt = useUi((s) => s.prompt);
  const close = useUi((s) => s.closePrompt);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(prompt?.initial ?? "");
    setError(null);
  }, [prompt]);

  if (!prompt) return null;

  const submit = () => {
    const err = prompt.validate?.(value) ?? (value.trim() ? null : "Please enter a name");
    if (err) return setError(err);
    close(value.trim());
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[18vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close(null)}
    >
      <div className="animate-pop w-[400px] rounded-xl border border-line bg-surface p-5 shadow-pop">
        <div className="mb-3 text-[14px] font-semibold text-ink">{prompt.title}</div>
        <input
          autoFocus
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => (setValue(e.target.value), setError(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close(null);
          }}
          placeholder={prompt.placeholder}
          spellCheck={false}
          className="w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[13.5px] text-ink outline-none focus:border-accent"
        />
        <div className="mt-1.5 h-4 text-[12px] text-danger">{error}</div>
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={() => close(null)} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-hover">
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            {prompt.confirmLabel ?? "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-pop rounded-full border border-line bg-surface px-4 py-2 text-[12.5px] shadow-pop ${
            t.tone === "error" ? "text-danger" : "text-ink"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
