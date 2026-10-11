import { EditorState, Range, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { assetUrl } from "../../lib/assets";
import { imageSource } from "../../lib/figure";
import { ImageRef, imageOnLine, pixelDensity } from "../../lib/images";
import { displayText, WikiLink } from "../../lib/links";

/** Opens a link; `side` = in the other pane (Ctrl+click). */
type Follow = (link: WikiLink, side: boolean) => void;

class ImageWidget extends WidgetType {
  constructor(
    readonly notebook: string,
    readonly ref: ImageRef,
    readonly follow?: Follow,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.notebook === this.notebook && o.ref.path === this.ref.path && o.ref.alt === this.ref.alt && o.ref.title === this.ref.title;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("figure");
    wrap.className = "cm-image-embed loading";
    const img = document.createElement("img");
    img.alt = this.ref.alt; // for screen readers; not shown as a caption
    img.draggable = false;
    const density = pixelDensity(this.ref.path);
    img.onload = () => {
      wrap.classList.remove("loading");
      // "@2x" images (e.g. PDF figures) show at their natural size, not doubled.
      if (density > 1) img.style.width = `${img.naturalWidth / density}px`;
    };
    const fail = () => {
      wrap.classList.remove("loading");
      wrap.classList.add("missing");
      wrap.textContent = `Image not found: ${this.ref.asset ?? this.ref.path}`;
    };
    img.onerror = fail;
    wrap.append(img);
    if (this.ref.asset) {
      assetUrl(this.notebook, this.ref.asset).then((u) => (img.src = u), fail);
    } else if (/^(https?:|data:image\/)/i.test(this.ref.path)) {
      img.src = this.ref.path;
    } else {
      fail();
    }
    // A PDF figure carries a link to its page: clicking the image opens it.
    const source = this.follow ? imageSource(this.ref.title) : null;
    if (source) {
      wrap.classList.add("linked");
      const where = displayText(source);
      img.title = `Open ${where}  (Ctrl+click: in the other pane)`;
      const badge = document.createElement("span");
      badge.className = "cm-image-source";
      badge.textContent = `↗ ${where}`;
      wrap.append(badge);
      img.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.follow!(source, e.ctrlKey || e.metaKey);
      });
    }
    // Click (beside a linked image) to edit the Markdown behind it.
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).to } });
      view.focus();
    });
    return wrap;
  }
  get estimatedHeight() {
    return 260;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, notebook: string, follow?: Follow): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) active.add(n);
  }
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (active.has(n) || !line.text.includes("![")) continue;
    const ref = imageOnLine(line.text);
    if (ref) decos.push(Decoration.replace({ widget: new ImageWidget(notebook, ref, follow), block: true }).range(line.from, line.to));
  }
  return Decoration.set(decos);
}

/**
 * Lines that are only `![alt](path)` render as the image (Markdown shows while
 * editing the line). Images whose title holds a [[link]] open it when clicked.
 */
export function imageEmbeds(notebook: string, follow?: Follow) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, notebook, follow),
    update(value, tr) {
      return tr.docChanged || tr.selection ? build(tr.state, notebook, follow) : value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
