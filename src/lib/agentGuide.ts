// The vault format, written for AI agents. Notely writes it to <vault>/AGENTS.md
// and the MCP server returns it from `get_guide`. Bump the version when it changes.

export const AGENT_GUIDE_VERSION = 3;

export const AGENT_GUIDE = `<!-- notely:generated v${AGENT_GUIDE_VERSION} — Notely keeps this file up to date. Delete this line to stop it. -->
# Notely vault — guide for AI agents

This folder is a **Notely** vault: plain files that the Notely desktop app shows live.
Anything you create or edit here appears in the app within a second. If the Notely
MCP server is connected, prefer its tools (they validate input and keep links intact);
otherwise edit the files directly following the rules below.

## Layout

\`\`\`
<vault>/
  AGENTS.md                      ← this guide
  <Notebook>/                    ← a notebook is a top-level folder
    <Note name>.md               ← a note (the file name is its title)
    <Canvas name>.canvas         ← a diagram (JSON Canvas)
    _pdfs/<file>.pdf             ← PDFs imported into the notebook
    .notely/highlights/<file>.pdf.json   ← PDF highlights (read-only for agents)
    .notely/cache/…              ← app caches; ignore
\`\`\`

Names: no \`\\ / : * ? " < > |\`, no leading/trailing dot or space. Folders starting
with \`.\` or \`_\` are not notebooks. Never delete files — leave that to the user.

## Notes

Markdown (GitHub-flavored: headings, lists, \`- [ ]\` tasks, quotes, code, tables).
Links resolve within the same notebook unless prefixed with another notebook's name:

| Syntax | Meaning |
|---|---|
| \`[[Note name]]\` | link to a note (created when clicked if missing) |
| \`[[Note name\\|shown text]]\` | link with display text |
| \`[[file.pdf]]\` | link to a PDF in \`_pdfs/\` |
| \`[[file.pdf#page=12]]\` | link to page 12 |
| \`[[file.pdf#hl-ab12cd]]\` | link to a highlight (ids are in the highlights JSON) |
| \`[[file.pdf#bm-ab12cd]]\` | link to a named bookmark in a PDF |
| \`[[Diagram.canvas]]\` | link to a canvas |
| \`[[Other notebook/Note]]\` | anything in **another notebook**: prefix the target with \`Notebook/\` |
| \`![[Diagram.canvas]]\` | **embed** a canvas preview — put it on its own line |

Any link can carry its own text, so it reads as part of a sentence:
\`The defenders were [[siege.pdf#hl-ab12cd|badly outnumbered]], as [[Logistics|supply notes]] explain.\`
Prefer this for citations: link the words that make the claim to the highlight or page that supports it.

Highlights file: \`{"version":2,"highlights":[{"id":"hl-…","page":3,"text":"…","color":"yellow","comment":"…"}],"bookmarks":[{"id":"bm-…","page":12,"name":"…"}]}\`.
Cite a passage with \`[[file.pdf#<id>]]\`; \`comment\` is the reader's own note on it.

**Tags**: \`#tag\` anywhere in a note or canvas text (letters/digits/\`-\`/\`_\`; \`/\` nests, e.g. \`#exam/midterm\`).
Reuse existing tags (MCP \`list_tags\`) rather than inventing near-duplicates.

## Canvases (diagrams, flowcharts)

\`.canvas\` files use the open **JSON Canvas** format (https://jsoncanvas.org):

\`\`\`json
{
  "nodes": [
    {"id": "start", "type": "text", "text": "Start", "shape": "ellipse", "x": 0, "y": 0, "width": 160, "height": 80},
    {"id": "check", "type": "text", "text": "Valid input?", "shape": "diamond", "color": "3"},
    {"id": "card",  "type": "file", "file": "Biology/Cell structure.md"}
  ],
  "edges": [
    {"id": "e1", "fromNode": "start", "toNode": "check"},
    {"id": "e2", "fromNode": "check", "toNode": "card", "label": "yes", "toEnd": "arrow"}
  ]
}
\`\`\`

- Node \`type\`: \`text\` (Markdown text), \`file\` (card for a note/PDF/canvas; path is
  vault-relative, e.g. \`Notebook/Note.md\` or \`Notebook/_pdfs/x.pdf\`), \`link\` (\`url\`), \`group\` (\`label\`; a box around other nodes).
- Notely extension: text nodes may set \`"shape"\`: \`rounded\` (default), \`rectangle\`, \`ellipse\`, \`diamond\`.
- \`color\`: \`"1"\` red, \`"2"\` orange, \`"3"\` yellow, \`"4"\` green, \`"5"\` cyan, \`"6"\` purple, or \`"#rrggbb"\`.
- Edges: \`fromSide\`/\`toSide\` (\`top\`/\`right\`/\`bottom\`/\`left\`) are optional; \`toEnd\` defaults to \`arrow\`, \`fromEnd\` to \`none\`; optional \`label\`.
- **You may omit \`x\`, \`y\`, \`width\`, \`height\`** (and even \`id\` on edges): Notely sizes the
  nodes to their text and lays out unplaced nodes as a top-to-bottom flowchart when it loads the file.
  Aliases \`label\` (for \`text\`) and \`from\`/\`to\` (for \`fromNode\`/\`toNode\`) are accepted.

## Good practice

- One idea per note; connect notes with \`[[links]]\` rather than repeating content.
- When summarizing a PDF, quote sparingly and cite pages: \`[[paper.pdf#page=4]]\`.
- Embed a diagram where it is discussed: \`![[Process.canvas]]\` on its own line.
- Don't edit files under \`.notely/\` and don't rename files by hand (links would break) —
  use the MCP \`rename_note\` tool, which rewrites links everywhere.
`;
