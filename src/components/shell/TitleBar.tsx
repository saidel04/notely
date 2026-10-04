import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, PanelLeft, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useUi } from "../../store/uiStore";
import { Logo } from "./Logo";

const win = getCurrentWindow();

export function TitleBar() {
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void win.isMaximized().then(setMaximized);
    const un = win.onResized(() => void win.isMaximized().then(setMaximized));
    return () => void un.then((f) => f());
  }, []);

  return (
    <div data-tauri-drag-region className="flex h-[38px] shrink-0 items-center select-none">
      <button
        onClick={toggleSidebar}
        title="Toggle sidebar (Ctrl+\)"
        className="ml-2 flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
      >
        <PanelLeft size={15} />
      </button>
      {!sidebarOpen && (
        <span data-tauri-drag-region className="ml-2 flex items-center gap-2 text-[12.5px] font-medium tracking-tight text-muted">
          <Logo size={16} />
          Notely
        </span>
      )}
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex h-full">
        <WinBtn onClick={() => win.minimize()} label="Minimize">
          <Minus size={15} strokeWidth={1.5} />
        </WinBtn>
        <WinBtn onClick={() => win.toggleMaximize()} label={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Copy size={12} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={12} strokeWidth={1.5} />}
        </WinBtn>
        <WinBtn onClick={() => win.close()} label="Close" danger>
          <X size={16} strokeWidth={1.5} />
        </WinBtn>
      </div>
    </div>
  );
}

function WinBtn({ children, onClick, label, danger }: { children: React.ReactNode; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-full w-[46px] items-center justify-center text-muted transition-colors ${
        danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
