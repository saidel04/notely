// Capturing a region of a PDF page inserts the figure into the note open beside
// the PDF: just the image, whose title carries the link back to its page.
import fs from "node:fs";
import path from "node:path";
import { checks } from "./harness.mjs";

export const name = "PDF region → figure";

export async function run({ page, vault, evaluate, wait }) {
  const c = checks();

  const pdf = await evaluate(() => {
    for (const nb of window.__notely.useVault.getState().notebooks) if (nb.pdfs[0]) return { notebook: nb.name, name: nb.pdfs[0].name };
    return null;
  });
  if (!pdf) {
    console.log("  (no PDF in the sandbox — skipping)");
    return c;
  }

  // Clear figure images from earlier runs: a name clash would get a "-2" suffix,
  // which breaks the "@2x" retina naming and the crispness check below.
  const assetsDir = path.join(vault, pdf.notebook, "_assets");
  const stem = pdf.name.replace(/\.pdf$/i, "").replace(/\(.*?\)/g, "").trim().slice(0, 40).trim();
  if (fs.existsSync(assetsDir)) {
    for (const f of fs.readdirSync(assetsDir)) if (f.startsWith(stem) && /@\d/.test(f)) fs.rmSync(path.join(assetsDir, f), { force: true });
  }

  await evaluate(async (p) => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook(p.notebook);
    if (V().notebooks.find((x) => x.name === p.notebook).notes.some((x) => x.name === "E2E Figure")) await V().deleteNote("E2E Figure");
    await V().createNote("E2E Figure", "Figures:\n");
    window.__notely.useWorkspace.getState().setLayout([{ kind: "pdf", name: p.name }, { kind: "note", name: "E2E Figure" }], 0);
  }, pdf);
  await wait(3000);

  // The PDF reopens where it was last read, so use whichever page is in view.
  const visiblePage = await evaluate(() => {
    const els = [...document.querySelectorAll('[data-pane="0"] [data-page]')];
    const vh = window.innerHeight;
    const best = els
      .map((el) => ({ n: Number(el.dataset.page), r: el.getBoundingClientRect() }))
      .map(({ n, r }) => ({ n, shown: Math.min(r.bottom, vh) - Math.max(r.top, 0) }))
      .sort((a, b) => b.shown - a.shown)[0];
    return best?.n ?? 1;
  });
  // Hover to reveal the toolbar, then switch on capture mode.
  const pageEl = page.locator(`[data-pane="0"] [data-page="${visiblePage}"]`);
  const b = await pageEl.boundingBox();
  // Keep the box inside the visible part of the page.
  const top = Math.max(b.y, 60);
  const bottom = Math.min(b.y + b.height, (await evaluate(() => window.innerHeight)) - 80);
  await page.mouse.move(b.x + b.width / 2, top + 20);
  await wait(300);
  await page.locator('button[title^="Capture a region"]').click();
  await wait(300);
  c.ok("capture mode shows its hint", (await page.getByText("Drag a box around a figure").count()) === 1);

  // Drag a box on that page.
  const span = bottom - top;
  await page.mouse.move(b.x + b.width * 0.2, top + span * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, top + span * 0.5, { steps: 6 });
  await page.mouse.up();
  await wait(2500);

  const text = await evaluate(() => window.__notely.useVault.getState().contents["E2E Figure"] ?? "");
  const figLine = text.split("\n").find((l) => l.includes("_assets/")) ?? "";
  c.ok("figure image inserted into the note", figLine.startsWith("![") && figLine.includes(`p. ${visiblePage}]`) && figLine.includes(".png"));
  c.ok("the page link rides inside the image, not on a line of its own", figLine.includes(`#page=${visiblePage}]]")`) && !text.includes("\n— [["));
  c.ok("text was not selected while capturing", (await evaluate(() => String(window.getSelection()))) === "");

  // The image is crisp: rendered at ≥2× of the box's CSS size.
  await page.locator('[data-pane="1"] .cm-content').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+Home");
  await wait(1500);
  // Wait for the figure to finish decoding, then compare its pixel size to its
  // on-screen size: a crisp figure is rendered at ≥1.8× (the @2x retina scale).
  await page.locator('[data-pane="1"] .cm-image-embed img').first().waitFor({ state: "attached" });
  const dims = await page
    .locator('[data-pane="1"] .cm-image-embed img')
    .first()
    .evaluate(
      (img) =>
        new Promise((r) => {
          const done = () => r({ natural: img.naturalWidth, shown: img.getBoundingClientRect().width });
          img.complete && img.naturalWidth ? done() : img.addEventListener("load", done, { once: true });
        }),
    );
  c.ok("figure renders, at high resolution", dims.natural >= dims.shown * 1.8);

  // Clicking the image opens the PDF at the figure's page.
  await evaluate(() => {
    const el = document.querySelector('[data-pane="0"] .overflow-auto');
    if (el) el.scrollTop = 1e6;
  });
  await wait(400);
  await page.locator('[data-pane="1"] .cm-image-embed.linked img').first().click();
  await wait(1500);
  const shown = await evaluate((n) => {
    const el = document.querySelector(`[data-pane="0"] [data-page="${n}"]`);
    const r = el?.getBoundingClientRect();
    return !!r && r.top < window.innerHeight && r.bottom > 0;
  }, visiblePage);
  c.ok("clicking the figure opens its page", shown);

  return c;
}
