# Notely

A calm, minimal Windows desktop app for reading PDFs and keeping linked notes beside them.

- **Read & highlight PDFs** — four highlight colors, comments on highlights, named bookmarks, the book's table of contents, in-PDF search, and light / dark / sepia pages.
- **Linked Markdown notes** — live-preview editor, `[[links]]` to notes, PDFs, pages, highlighted quotes, bookmarks and canvases (also across notebooks), links on any words you choose, hover previews, backlinks and `#tags`.
- **Side by side** — two resizable panes; drag a quote from the PDF into a note and it lands as a cited blockquote.
- **Canvases** — diagrams and flowcharts in the open [JSON Canvas](https://jsoncanvas.org) format, embeddable in notes with `![[Name.canvas]]`.
- **Explore** — notebook-wide search, a link map of how everything connects, Markdown/PDF export.
- **Agent-friendly** — a bundled MCP server lets AI agents (Claude Code, Claude Desktop, Cursor…) create notebooks, write linked notes, read PDFs and highlights, and draw diagrams. Every vault also contains an `AGENTS.md` describing the format.

Everything is stored as plain files in a folder you choose — notebooks are folders, notes are `.md` files.

## Development

Requires Node.js and Rust.

```sh
npm install
npm run tauri dev        # uses your real Notely settings and vault
npm run dev:sandbox      # separate app id + settings, for testing safely
npm test                 # unit tests (Vitest)
npm run tauri build      # Windows installer → src-tauri/target/release/bundle/nsis
```

Stack: Tauri 2 (Rust) · React 19 · TypeScript · Vite · Tailwind CSS 4 · Zustand · pdf.js · CodeMirror 6 · d3-force.

## Connecting an AI agent

In the app: **Settings → Connect an AI agent…** shows the exact setup. For Claude Code:

```sh
claude mcp add notely -- node "<path to notely-mcp.mjs>" --vault "<your vault folder>"
```

The server is built to `agent/dist/notely-mcp.mjs` by `npm run build:agent` and ships inside the installer.
