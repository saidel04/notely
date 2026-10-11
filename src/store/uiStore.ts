import { create } from "zustand";
import { settings } from "../lib/settings";

export type Theme = "system" | "light" | "dark";
export type EditorFont = "serif" | "sans";
export type PdfTheme = "auto" | "light" | "dark" | "sepia";
export type PaletteKind = "files" | "commands" | "search" | "templates";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  /** An optional button on the toast (e.g. "Undo"). Keeps the toast up longer. */
  action?: { label: string; run: () => void };
}

export interface PromptRequest {
  title: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  resolve: (value: string | null) => void;
}

interface UiStore {
  theme: Theme;
  editorFont: EditorFont;
  pdfTheme: PdfTheme;
  sidebarOpen: boolean;
  palette: PaletteKind | null;
  /** When set, the file palette opens its pick beside the focused pane. */
  paletteSide: boolean;
  toasts: Toast[];
  prompt: PromptRequest | null;
  agentPanel: boolean;
  /** Sidebar shows only notes/canvases with this tag. */
  tagFilter: string | null;
  /** Flashcard review session: all PDFs in the notebook (pdf null) or one PDF. */
  review: { pdf: string | null } | null;
  /** Version history panel for a note. */
  history: { note: string } | null;
  /** The tab being dragged, so the workspace can offer to snap it left or right. */
  tabDrag: { pane: 0 | 1; index: number } | null;
  /** Heading outline beside notes. */
  outlineOpen: boolean;

  init(): Promise<void>;
  toggleOutline(): void;
  setTheme(theme: Theme): void;
  cycleTheme(): void;
  setEditorFont(font: EditorFont): void;
  setPdfTheme(theme: PdfTheme): void;
  toggleSidebar(): void;
  openPalette(kind: PaletteKind | null, side?: boolean): void;
  toast(message: string, tone?: Toast["tone"]): void;
  /** A toast with an action button; dismissed when the action runs. */
  toastAction(message: string, label: string, run: () => void): void;
  dismissToast(id: number): void;
  ask(req: Omit<PromptRequest, "resolve">): Promise<string | null>;
  closePrompt(value: string | null): void;
}

let toastId = 0;

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export const useUi = create<UiStore>((set, get) => ({
  theme: "system",
  editorFont: "serif",
  pdfTheme: "auto",
  sidebarOpen: true,
  palette: null,
  paletteSide: false,
  toasts: [],
  prompt: null,
  agentPanel: false,
  tagFilter: null,
  review: null,
  history: null,
  tabDrag: null,
  outlineOpen: false,

  async init() {
    const theme = (await settings.get<Theme>("theme")) ?? "system";
    const editorFont = (await settings.get<EditorFont>("editorFont")) ?? "serif";
    const sidebarOpen = (await settings.get<boolean>("sidebarOpen")) ?? true;
    const pdfTheme = (await settings.get<PdfTheme>("pdfTheme")) ?? "auto";
    const outlineOpen = (await settings.get<boolean>("outlineOpen")) ?? false;
    set({ theme, editorFont, sidebarOpen, pdfTheme, outlineOpen });
    applyTheme(theme);
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => applyTheme(get().theme));
  },

  toggleOutline() {
    const outlineOpen = !get().outlineOpen;
    set({ outlineOpen });
    void settings.set("outlineOpen", outlineOpen);
  },

  setTheme(theme) {
    set({ theme });
    applyTheme(theme);
    void settings.set("theme", theme);
  },

  cycleTheme() {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(get().theme) + 1) % order.length];
    get().setTheme(next);
    get().toast(`Theme: ${next}`);
  },

  setEditorFont(editorFont) {
    set({ editorFont });
    void settings.set("editorFont", editorFont);
  },

  setPdfTheme(pdfTheme) {
    set({ pdfTheme });
    void settings.set("pdfTheme", pdfTheme);
  },

  toggleSidebar() {
    const sidebarOpen = !get().sidebarOpen;
    set({ sidebarOpen });
    void settings.set("sidebarOpen", sidebarOpen);
  },

  openPalette(palette, side = false) {
    set({ palette, paletteSide: side });
  },

  toast(message, tone = "info") {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    window.setTimeout(() => get().dismissToast(id), 2600);
  },

  toastAction(message, label, run) {
    const id = ++toastId;
    const action = {
      label,
      run: () => {
        get().dismissToast(id);
        run();
      },
    };
    set((s) => ({ toasts: [...s.toasts, { id, message, tone: "info", action }] }));
    window.setTimeout(() => get().dismissToast(id), 8000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  ask(req) {
    get().prompt?.resolve(null);
    return new Promise((resolve) => set({ prompt: { ...req, resolve } }));
  },

  closePrompt(value) {
    get().prompt?.resolve(value);
    set({ prompt: null });
  },
}));
