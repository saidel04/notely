// Deleting a note or PDF offers an "Undo" toast that restores it (a PDF keeps
// its highlights and bookmarks).
import { checks } from "./harness.mjs";

export const name = "undo delete";

// Runs the newest Undo toast (several can be live at once).
const clickUndo = (evaluate) =>
  evaluate(() => [...window.__notely.useUi.getState().toasts].reverse().find((t) => t.action?.label === "Undo")?.action.run());
const clearToasts = (evaluate) => evaluate(() => window.__notely.useUi.setState({ toasts: [] }));

export async function run({ evaluate, wait }) {
  const c = checks();

  // ---- note ----
  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    if (!V().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === "Scratch"))
      await V().createNote("Scratch", "disposable\n");
  });
  await wait(500);
  await clearToasts(evaluate); // drop any lingering undo toasts from earlier specs
  await evaluate(() => window.__notely.useVault.getState().deleteNote("Scratch"));
  await wait(500);
  c.ok("deleting a note shows an Undo toast", await evaluate(() => window.__notely.useUi.getState().toasts.some((t) => t.action?.label === "Undo")));
  await clickUndo(evaluate);
  await wait(1200);
  c.ok("undo restored the note", await evaluate(() => window.__notely.useVault.getState().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === "Scratch")));
  c.ok("restored note kept its content", (await evaluate(() => window.__notely.useVault.getState().contents.Scratch) ?? "").includes("disposable"));

  // ---- pdf (only if the sandbox has one with highlights) ----
  const pdf = await evaluate(() => {
    const V = window.__notely.useVault.getState();
    for (const nb of V.notebooks) {
      const p = nb.pdfs[0];
      if (p) return { notebook: nb.name, name: p.name };
    }
    return null;
  });
  if (!pdf) {
    console.log("  (no PDF in the sandbox — skipping the PDF undo check)");
    return c;
  }

  await evaluate((p) => window.__notely.useVault.getState().setActiveNotebook(p.notebook), pdf);
  await wait(800);
  await evaluate((p) => window.__notely.useHighlights.getState().ensure(p.notebook, p.name), pdf);
  await wait(600);
  const before = await evaluate((p) => {
    const k = `${p.notebook}/${p.name}`.toLowerCase();
    const hs = window.__notely.useHighlights.getState();
    return { hl: (hs.byPdf[k] ?? []).length, bm: (hs.bookmarks[k] ?? []).length };
  }, pdf);

  await clearToasts(evaluate);
  await evaluate((p) => window.__notely.useVault.getState().deletePdf(p.name), pdf);
  await wait(900);
  c.ok("deleting a PDF shows an Undo toast", await evaluate(() => window.__notely.useUi.getState().toasts.some((t) => t.action?.label === "Undo")));
  await clickUndo(evaluate);
  await wait(2000);
  await evaluate((p) => window.__notely.useHighlights.getState().ensure(p.notebook, p.name), pdf);
  await wait(800);
  const after = await evaluate((p) => {
    const k = `${p.notebook}/${p.name}`.toLowerCase();
    const hs = window.__notely.useHighlights.getState();
    return {
      present: window.__notely.useVault.getState().notebooks.find((x) => x.name === p.notebook).pdfs.some((x) => x.name === p.name),
      hl: (hs.byPdf[k] ?? []).length,
      bm: (hs.bookmarks[k] ?? []).length,
    };
  }, pdf);
  c.ok("undo restored the PDF", after.present);
  c.ok("highlights restored", after.hl === before.hl);
  c.ok("bookmarks restored", after.bm === before.bm);

  return c;
}
