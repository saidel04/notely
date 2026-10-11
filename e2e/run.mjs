// Runs the end-to-end smoke specs against the running sandbox app.
//
//   1. npm run dev:sandbox   (launched with WebView2 remote debugging — see README.md)
//   2. node e2e/run.mjs      (optionally name specs: node e2e/run.mjs canvasUndo)
//
// Exits non-zero if any check fails, so it can gate a release.

import { connect } from "./harness.mjs";
import * as crossNotebook from "./crossNotebook.spec.mjs";
import * as canvasUndo from "./canvasUndo.spec.mjs";
import * as canvasExtras from "./canvasExtras.spec.mjs";
import * as deleteUndo from "./deleteUndo.spec.mjs";
import * as images from "./images.spec.mjs";
import * as figure from "./figure.spec.mjs";
import * as review from "./review.spec.mjs";
import * as noteTools from "./noteTools.spec.mjs";
import * as tabs from "./tabs.spec.mjs";
import * as tagRename from "./tagRename.spec.mjs";
import * as templates from "./templates.spec.mjs";
import * as history from "./history.spec.mjs";

const ALL = [crossNotebook, canvasUndo, canvasExtras, deleteUndo, images, figure, review, noteTools, tabs, tagRename, templates, history];

const only = process.argv.slice(2);
const specs = only.length
  ? ALL.filter((s) => only.some((o) => s.name.toLowerCase().includes(o.toLowerCase())))
  : ALL;

const ctx = await connect();
console.log(`Connected to sandbox vault:\n  ${ctx.vault}\n`);

let failed = 0;
for (const spec of specs) {
  console.log(`▶ ${spec.name}`);
  try {
    const c = await spec.run(ctx);
    failed += c.failed;
  } catch (e) {
    console.log(`  ✗ threw: ${e.message}`);
    failed++;
  }
  console.log("");
}

if (ctx.errors.length) {
  console.log("Console/page errors during the run:");
  for (const e of ctx.errors) console.log("  !", e);
}

console.log(failed ? `FAILED (${failed} check${failed === 1 ? "" : "s"})` : "All checks passed.");
process.exit(failed ? 1 : 0);
