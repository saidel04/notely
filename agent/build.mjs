// Bundles the MCP server into agent/dist (a single .mjs plus the pdf.js worker),
// so it runs with plain `node` — no node_modules needed.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("agent/dist", { recursive: true });
await build({
  entryPoints: ["agent/notely-mcp.ts"],
  outfile: "agent/dist/notely-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
copyFileSync("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "agent/dist/pdf.worker.mjs");
console.log("Built agent/dist/notely-mcp.mjs");
