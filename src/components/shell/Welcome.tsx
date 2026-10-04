import { documentDir, join } from "@tauri-apps/api/path";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { actions } from "../../lib/actions";
import { Logo } from "./Logo";
import { errorMessage } from "../../lib/vault";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";

export function Welcome() {
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    void documentDir()
      .then((d) => join(d, "Notely"))
      .then(setSuggested);
  }, []);

  const useSuggested = async () => {
    if (!suggested) return;
    try {
      await useVault.getState().openVault(suggested);
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  };

  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center">
      <div className="animate-fade w-[380px] text-center">
        <Logo size={64} className="mx-auto mb-6" />
        <h1 className="mb-2 text-[22px] font-semibold tracking-tight text-ink">Welcome to Notely</h1>
        <p className="mb-8 text-[13.5px] leading-relaxed text-muted">
          Read and highlight PDFs, and keep linked notes beside them. Everything is stored as plain files in a folder you
          choose.
        </p>
        <button
          onClick={useSuggested}
          disabled={!suggested}
          className="mb-2.5 w-full rounded-lg bg-accent px-4 py-2.5 text-[13.5px] font-medium text-white hover:opacity-90"
        >
          Create vault in Documents
          {suggested && <div className="mt-0.5 truncate text-[11.5px] font-normal opacity-75">{suggested}</div>}
        </button>
        <button
          onClick={() => actions.chooseVault()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-[13.5px] text-ink hover:bg-hover"
        >
          <FolderOpen size={15} className="text-muted" /> Choose another folder…
        </button>
      </div>
    </div>
  );
}
