// Canvas extras: freehand pen strokes, the eraser, a card linked to a note,
// and PNG/SVG export. Drawings and image cards are plain JSON Canvas nodes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checks } from "./harness.mjs";

export const name = "canvas pen, links and export";

export async function run({ page, evaluate, wait }) {
  const c = checks();
  const nodes = () => evaluate(() => window.__notely.useCanvases.getState().data.E2EX?.nodes ?? []);
  const typeOf = (ns, t) => ns.filter((n) => n.type === t);

  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    const nb = V().notebooks.find((x) => x.name === "Beta");
    if (nb.canvases.some((c) => c.name === "E2EX")) await V().deleteCanvas("E2EX");
    if (!nb.notes.some((n) => n.name === "Canvas Target")) await V().createNote("Canvas Target", "A note to link to.\n");
  });
  await wait(400);
  await evaluate(() => window.__notely.useVault.getState().createCanvas("E2EX"));
  await wait(400);
  await evaluate(() => window.__notely.useWorkspace.getState().open({ kind: "canvas", name: "E2EX" }));
  await wait(1200);

  const cv = page.locator(".cv").first();
  const b = await cv.boundingBox();
  await cv.click({ position: { x: 20, y: 20 } }); // focus the canvas

  // --- Pen: draw a stroke ---
  await page.locator('[data-pane="0"] button[title^="Pen"]').click();
  await wait(200);
  await page.mouse.move(b.x + 120, b.y + 120);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 120 + i * 18, b.y + 120 + Math.sin(i) * 25, { steps: 2 });
  await page.mouse.up();
  await wait(500);
  let ns = await nodes();
  c.ok("the pen added a drawing node", typeOf(ns, "drawing").length === 1);
  const stroke = typeOf(ns, "drawing")[0];
  c.ok("the drawing stores its stroke points", Array.isArray(stroke.points) && stroke.points.length >= 4);

  // --- Eraser: rub it out ---
  await page.locator('[data-pane="0"] button[title^="Eraser"]').click();
  await wait(200);
  // Sweep across where the stroke was drawn.
  await page.mouse.move(b.x + 120, b.y + 120);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 120 + i * 16, b.y + 120 + Math.sin(i) * 25, { steps: 2 });
  await page.mouse.up();
  await wait(500);
  ns = await nodes();
  c.ok("the eraser removed the stroke", typeOf(ns, "drawing").length === 0);

  await page.locator('[data-pane="0"] button[title^="Select"]').click();

  // --- A card linked to a note (added through the app's own action) ---
  await evaluate(() => {
    const cv = window.__notely.useCanvases.getState();
    const d = cv.data.E2EX;
    cv.set("E2EX", { ...d, nodes: [...d.nodes, { id: "card1", type: "file", file: "Beta/Canvas Target.md", x: 0, y: 0, width: 300, height: 180 }] });
  });
  await wait(300);
  ns = await nodes();
  c.ok("a note card points at the note file", typeOf(ns, "file").some((n) => /Canvas Target\.md$/.test(n.file)));

  // Fit the view so the card (added at world 0,0) is on screen, then double-click it to open the note.
  await page.locator('[data-pane="0"] button[title^="Fit to content"]').click();
  await wait(500);
  const card = page.locator('[data-pane="0"] [data-node="card1"] .cv-card').first();
  await card.click(); // select it
  await wait(300);
  await page.keyboard.press("Enter"); // open the linked note
  await wait(1000);
  const open = await evaluate(() => window.__notely.useWorkspace.getState().panes.some((p) => p?.kind === "note" && p.name === "Canvas Target"));
  c.ok("opening a card follows its link to the note", open);
  // Reopen the canvas for the export checks below.
  await evaluate(() => window.__notely.useWorkspace.getState().open({ kind: "canvas", name: "E2EX" }));
  await wait(600);

  // --- Export to PNG and SVG (writing to a temp file, bypassing the save dialog) ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notely-cv-"));
  for (const fmt of ["png", "svg"]) {
    const out = path.join(dir, `canvas.${fmt}`);
    await evaluate(
      async ({ out, fmt }) => {
        const m = await import("/src/components/canvas/canvasExport.tsx");
        const data = window.__notely.useCanvases.getState().data.E2EX;
        await m.exportCanvasToPath(data, "Beta", fmt, out);
      },
      { out, fmt },
    );
    await wait(600);
    const exists = fs.existsSync(out) && fs.statSync(out).size > 100;
    c.ok(`exported a non-empty ${fmt.toUpperCase()}`, exists);
    if (fmt === "svg" && exists) c.ok("the SVG is real markup", fs.readFileSync(out, "utf8").includes("<svg"));
  }
  fs.rmSync(dir, { recursive: true, force: true });

  await evaluate(() => window.__notely.useVault.getState().deleteCanvas("E2EX"));
  await wait(300);
  return c;
}
