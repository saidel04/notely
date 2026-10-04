import { EditorState, Range, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { canvasBase, parseLinks, WikiLink } from "../../lib/links";
import { CanvasPreview } from "../canvas/CanvasPreview";

export interface EmbedConfig {
  notebook: string;
  /** Resolves a canvas link target (maybe "Notebook/Name.canvas") to an existing canvas. */
  resolve(target: string): { name: string; notebook: string; local: boolean } | null;
  open(link: WikiLink, side: boolean): void;
}

/** A line that is nothing but `![[Something.canvas]]` becomes a preview block. */
export function embedOnLine(text: string, from: number): WikiLink | null {
  const links = parseLinks(text, from);
  if (links.length !== 1) return null;
  const l = links[0];
  if (!l.embed || l.kind !== "canvas") return null;
  return text.trim() === l.raw ? l : null;
}

class CanvasEmbedWidget extends WidgetType {
  private root: Root | null = null;
  constructor(
    readonly name: string,
    readonly link: WikiLink,
    readonly cfg: EmbedConfig,
    /** Set when the canvas lives in another notebook (no live preview, just a card). */
    readonly elsewhere: string | null,
  ) {
    super();
  }
  eq(o: CanvasEmbedWidget) {
    return o.name === this.name && o.link.from === this.link.from && o.elsewhere === this.elsewhere;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-canvas-embed";
    this.root = createRoot(el);
    this.root.render(
      createElement(CanvasPreview, {
        notebook: this.cfg.notebook,
        name: this.name,
        elsewhere: this.elsewhere,
        onOpen: (side: boolean) => this.cfg.open(this.link, side),
      }),
    );
    return el;
  }
  destroy() {
    const r = this.root;
    this.root = null;
    // Unmount after CodeMirror finishes its DOM update.
    queueMicrotask(() => r?.unmount());
  }
  get estimatedHeight() {
    return 292;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, cfg: EmbedConfig): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) activeLines.add(n);
  }
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes("![[") || activeLines.has(n)) continue;
    const link = embedOnLine(line.text, line.from);
    if (!link) continue;
    const ref = cfg.resolve(link.target);
    const name = ref?.name ?? canvasBase(link.name);
    const elsewhere = ref && !ref.local ? ref.notebook : link.notebook && !ref ? link.notebook : null;
    decos.push(Decoration.replace({ widget: new CanvasEmbedWidget(name, link, cfg, elsewhere), block: true }).range(line.from, line.to));
  }
  return Decoration.set(decos);
}

/** Canvas embeds rendered as live previews (raw text shows while the cursor is on the line). */
export function canvasEmbeds(cfg: EmbedConfig) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, cfg),
    update(value, tr) {
      return tr.docChanged || tr.selection ? build(tr.state, cfg) : value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
