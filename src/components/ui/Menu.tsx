import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** A floating surface at fixed client coordinates that closes on outside click / Escape. */
export function Floating({
  x,
  y,
  onClose,
  children,
  className = "",
  placement = "below",
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "below" | "above";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep it inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let top = placement === "above" ? y - height - 8 : y;
    if (top + height > window.innerHeight - 8) top = Math.max(8, y - height - 4);
    if (top < 8) top = 8;
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    setPos({ left, top });
  }, [x, y, placement]);

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", down);
      window.addEventListener("contextmenu", down);
    });
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("contextmenu", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={pos}
      className={`animate-pop fixed z-50 rounded-lg border border-line bg-surface shadow-pop ${className}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
}

export function Menu({
  x,
  y,
  items,
  onClose,
  header,
  placement,
}: {
  x: number;
  y: number;
  items: (MenuItem | "divider")[];
  onClose: () => void;
  header?: ReactNode;
  placement?: "below" | "above";
}) {
  return (
    <Floating x={x} y={y} onClose={onClose} placement={placement} className="min-w-[190px] p-1">
      {header}
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={item.label}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover ${
              item.danger ? "text-danger" : "text-ink"
            }`}
          >
            {item.icon && <span className="text-muted [&>svg]:size-[15px]">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-[11.5px] text-faint">{item.hint}</span>}
          </button>
        ),
      )}
    </Floating>
  );
}

/** Convenience hook for right-click menus. */
export function useMenu<T = undefined>() {
  const [state, setState] = useState<{ x: number; y: number; data: T } | null>(null);
  return {
    state,
    open: (e: { clientX: number; clientY: number; preventDefault(): void }, data: T) => {
      e.preventDefault();
      setState({ x: e.clientX, y: e.clientY, data });
    },
    close: () => setState(null),
  };
}
