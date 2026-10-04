import { syntaxTree } from "@codemirror/language";
import { EditorState, Range, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { displayText, parseLinks, WikiLink } from "../../lib/links";
import { parseTags } from "../../lib/tags";
import { embedOnLine } from "./embeds";

export interface LivePreviewConfig {
  /** Whether a link target exists in the notebook. */
  exists(link: WikiLink): boolean;
  /** Text of a highlight, if loaded, for nicer chip labels. */
  highlightText(link: WikiLink): string | undefined;
  follow(link: WikiLink, side: boolean): void;
  /** Pointer entered (rect) or left (null) a rendered link. */
  hover?(link: WikiLink | null, rect?: DOMRect): void;
  /** A #tag was clicked (outside the line being edited). */
  tag?(tag: string): void;
}

function linkAt(view: EditorView, el: HTMLElement): WikiLink | null {
  const from = Number(el.dataset.from);
  const ln = view.state.doc.lineAt(from);
  return parseLinks(ln.text, ln.from).find((l) => l.from === from) ?? null;
}

/** Dispatch to force decorations to rebuild (e.g. after the notebook or highlights change). */
export const refreshPreview = StateEffect.define<null>();

const ICONS = {
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8M16 17H8"/>',
  pdf: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  canvas: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
};

const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly label: string,
    readonly icon: keyof typeof ICONS,
    readonly missing: boolean,
    readonly quote: boolean,
    /** Link with custom text (`[[target|text]]`): reads as part of the sentence, no icon. */
    readonly inline: boolean,
  ) {
    super();
  }
  eq(o: WikiLinkWidget) {
    return (
      o.from === this.from && o.label === this.label && o.missing === this.missing && o.icon === this.icon && o.inline === this.inline
    );
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-wikilink${this.missing ? " missing" : ""}${this.quote ? " quote" : ""}${this.inline ? " inline" : ""}`;
    el.dataset.from = String(this.from);
    el.dataset.kind = this.icon;
    if (!this.inline) el.innerHTML = svg(ICONS[this.icon]);
    el.append(this.label);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bullet";
    el.textContent = "•";
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-hr";
    return el;
  }
}

const BLOCK_NODES = /^(Document|Blockquote|BulletList|OrderedList|ListItem|Paragraph|FencedCode|CodeBlock|ATXHeading\d|SetextHeading\d|Table)$/;

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

function activeLines(state: EditorState) {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) lines.add(i);
  }
  return lines;
}

function build(view: EditorView, cfg: LivePreviewConfig): DecorationSet {
  const { state } = view;
  const decos: Range<Decoration>[] = [];
  const active = activeLines(state);
  const focused = view.hasFocus;
  const isActive = (pos: number) => focused && active.has(state.doc.lineAt(pos).number);
  const sel = state.selection.main;

  // Wiki links first: markdown nodes inside them are skipped below.
  const wiki: [number, number][] = [];
  for (const { from, to } of view.visibleRanges) {
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const ln = state.doc.line(n);
      const embedLine = embedOnLine(ln.text, ln.from);
      for (const link of parseLinks(ln.text, ln.from)) {
        wiki.push([link.from, link.to]);
        if (embedLine) {
          // The embeds field renders this line as a preview; show raw text while editing it.
          decos.push(mark("cm-wikilink-raw").range(link.from, link.to));
          continue;
        }
        const touching = focused && sel.from <= link.to && sel.to >= link.from;
        if (touching) {
          decos.push(mark("cm-wikilink-raw").range(link.from, link.to));
          continue;
        }
        const hlText = link.highlightId || link.bookmarkId ? cfg.highlightText(link) : undefined;
        const icon =
          link.kind === "note" ? "note" : link.kind === "canvas" ? "canvas" : link.highlightId ? "highlight" : link.bookmarkId ? "bookmark" : "pdf";
        const widget = new WikiLinkWidget(
          link.from,
          displayText(link, hlText),
          icon,
          !cfg.exists(link),
          !!hlText && !link.alias && !!link.highlightId,
          !!link.alias,
        );
        decos.push(Decoration.replace({ widget }).range(link.from, link.to));
      }
    }
  }
  const inWiki = (a: number, b: number) => wiki.some(([f, t]) => a < t && b > f);

  for (const { from, to } of view.visibleRanges) {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
      const ln = state.doc.line(n);
      if (!ln.text.includes("#")) continue;
      for (const t of parseTags(ln.text, ln.from)) {
        if (inWiki(t.from, t.to) || /Code/.test(syntaxTree(state).resolveInner(t.from, 1).name)) continue;
        decos.push(Decoration.mark({ class: "cm-tag", attributes: { "data-tag": t.tag } }).range(t.from, t.to));
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const { name } = node;
        // Inline syntax inside [[links]] is the link's business; block structure (quotes, lists…) still applies.
        if (!BLOCK_NODES.test(name) && inWiki(node.from, node.to)) return;

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          decos.push(line(`cm-h${heading[1]}`).range(state.doc.lineAt(node.from).from));
          return;
        }

        switch (name) {
          case "HeaderMark": {
            if (node.node.parent?.name.startsWith("ATXHeading") && !isActive(node.from)) {
              const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
              decos.push(hide.range(node.from, end));
            } else decos.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          }
          case "Emphasis":
            decos.push(mark("cm-em").range(node.from, node.to));
            break;
          case "StrongEmphasis":
            decos.push(mark("cm-strong").range(node.from, node.to));
            break;
          case "Strikethrough":
            decos.push(mark("cm-strike").range(node.from, node.to));
            break;
          case "InlineCode":
            decos.push(mark("cm-inline-code").range(node.from, node.to));
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            if (!isActive(node.from)) decos.push(hide.range(node.from, node.to));
            else decos.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode" && !isActive(node.from))
              decos.push(hide.range(node.from, node.to));
            else decos.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          case "FencedCode":
          case "CodeBlock": {
            const a = state.doc.lineAt(node.from).number;
            const b = state.doc.lineAt(node.to).number;
            for (let i = a; i <= b; i++) decos.push(line("cm-codeblock").range(state.doc.line(i).from));
            return false;
          }
          case "Blockquote": {
            const a = state.doc.lineAt(node.from).number;
            const b = state.doc.lineAt(node.to).number;
            for (let i = a; i <= b; i++) decos.push(line("cm-quote").range(state.doc.line(i).from));
            break;
          }
          case "QuoteMark":
            if (!isActive(node.from)) {
              const next = state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
              decos.push(hide.range(node.from, next));
            }
            break;
          case "ListMark": {
            const list = node.node.parent?.parent?.name;
            const isTask = node.node.parent?.getChild("Task");
            if (list === "BulletList" && !isActive(node.from)) {
              if (isTask) decos.push(hide.range(node.from, node.to + 1));
              else decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            } else decos.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          }
          case "TaskMarker":
            if (!isActive(node.from)) {
              const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
              decos.push(
                Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to),
              );
            }
            break;
          case "HorizontalRule":
            if (!isActive(node.from))
              decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            break;
          case "Link": {
            const marks = node.node.getChildren("LinkMark");
            const url = node.node.getChild("URL");
            if (marks.length < 2 || !url) break;
            if (isActive(node.from)) {
              decos.push(mark("cm-md-mark").range(node.from, node.to));
              break;
            }
            decos.push(hide.range(marks[0].from, marks[0].to));
            decos.push(mark("cm-md-link").range(marks[0].to, marks[1].from));
            decos.push(hide.range(marks[1].from, node.to));
            return false;
          }
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

export function livePreview(cfg: LivePreviewConfig) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, cfg);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.focusChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state) ||
          u.transactions.some((t) => t.effects.some((e) => e.is(refreshPreview)))
        ) {
          this.decorations = build(u.view, cfg);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-wikilink");
      if (!el || e.button !== 0) return false;
      const link = linkAt(view, el);
      if (!link) return false;
      e.preventDefault();
      cfg.hover?.(null);
      cfg.follow(link, e.ctrlKey || e.metaKey);
      return true;
    },
    mouseover(e, view) {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-wikilink");
      if (!el || !cfg.hover) return false;
      const link = linkAt(view, el);
      if (link) cfg.hover(link, el.getBoundingClientRect());
      return false;
    },
    mouseout(e) {
      const el = (e.target as HTMLElement).closest(".cm-wikilink");
      const to = (e.relatedTarget as HTMLElement | null)?.closest?.(".cm-wikilink");
      if (el && to !== el) cfg.hover?.(null);
      return false;
    },
    click(e, view) {
      const tagEl = (e.target as HTMLElement).closest<HTMLElement>(".cm-tag");
      if (tagEl && cfg.tag) {
        // Clicking a tag filters by it — unless you're editing that line.
        const pos = view.posAtDOM(tagEl);
        const editing = view.hasFocus && view.state.doc.lineAt(view.state.selection.main.head).number === view.state.doc.lineAt(pos).number;
        if (!editing || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          cfg.tag(tagEl.dataset.tag!);
          return true;
        }
      }
      const a = (e.target as HTMLElement).closest(".cm-md-link");
      return !!a && (e.ctrlKey || e.metaKey);
    },
  });

  return [plugin, clicks];
}
