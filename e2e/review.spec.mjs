// Flashcard review: highlights become cards, answers are scheduled with
// spaced repetition, and progress is kept.
import { checks } from "./harness.mjs";

export const name = "flashcard review";

export async function run({ page, evaluate, wait }) {
  const c = checks();

  // Make two highlights (one with a comment = a question) on the first PDF.
  const nb = await evaluate(async () => {
    const V = window.__notely.useVault.getState();
    const n = V.notebooks.find((x) => x.pdfs.length);
    if (!n) return null;
    await V.setActiveNotebook(n.name);
    const H = window.__notely.useHighlights.getState();
    const pdf = n.pdfs[0].name;
    await H.ensure(n.name, pdf);
    const rect = (y) => [{ page: 1, x: 0.1, y, w: 0.4, h: 0.02 }];
    const a = H.add(n.name, pdf, { page: 1, rects: rect(0.1), text: "The defenders must guard the gates at night.", color: "yellow", comment: "What must the defenders guard?" });
    const b = H.add(n.name, pdf, { page: 1, rects: rect(0.2), text: "Watchmen are chosen by lot each evening.", color: "green" });
    let cards = 0;
    for (const p of n.pdfs) cards += (await H.ensure(n.name, p.name)).filter((h) => h.text.trim()).length;
    return { notebook: n.name, pdf, ids: [a.id, b.id], cards };
  });
  if (!nb) {
    console.log("  (no PDF in the sandbox — skipping)");
    return c;
  }
  await evaluate(async (n) => {
    await window.__notely.useReview.getState().load(n.notebook);
    window.__notely.useReview.setState({ states: {} });
    window.__notely.useWorkspace.getState().setLayout([null, null], 0);
  }, nb);
  await wait(1200);

  const badge = await page.locator('aside button[aria-label^="Review flashcards"]').getAttribute("aria-label");
  c.ok(`sidebar shows ${nb.cards} cards waiting`, badge === `Review flashcards, ${Math.min(nb.cards, 20)} waiting`);

  await page.locator('aside button[aria-label^="Review flashcards"]').click();
  await wait(1000);
  c.ok("review panel opens with a card", (await page.getByRole("button", { name: /Show answer/ }).count()) === 1);

  await page.keyboard.press("Space");
  await wait(300);
  c.ok("Space reveals the passage and the answer buttons", (await page.locator('[role="dialog"] blockquote').count()) === 1 && (await page.getByRole("button", { name: /^Good/ }).count()) === 1);

  // Good on the first card, Again on the next (it comes back), then Good.
  await page.keyboard.press("3");
  await wait(300);
  await page.keyboard.press("Space");
  await wait(200);
  await page.keyboard.press("1");
  await wait(300);
  const leftAfterAgain = await page.locator('[role="dialog"] header').innerText();
  c.ok("a forgotten card is queued again", leftAfterAgain.includes(`${nb.cards - 1} left`));

  for (let i = 0; i < nb.cards; i++) {
    if (!(await page.getByRole("button", { name: /Show answer/ }).count())) break;
    await page.keyboard.press("Space");
    await wait(150);
    await page.keyboard.press("3");
    await wait(250);
  }
  c.ok("session ends with a summary", (await page.getByText(/Session complete/).count()) === 1);

  const states = await evaluate(() => window.__notely.useReview.getState().states);
  const scheduled = Object.values(states);
  c.ok("every card is scheduled at least a day out", scheduled.length === nb.cards && scheduled.every((s) => s.due > Date.now() + 23 * 3600e3));
  c.ok("the forgotten card recorded a lower ease", scheduled.some((s) => s.ease < 2.5));

  await page.keyboard.press("Escape");
  await wait(1500); // let progress save
  c.ok("sidebar badge clears once caught up", (await page.locator('aside button[aria-label="Review flashcards"]').count()) === 1);

  // Progress survives a reload from disk.
  await evaluate(async (n) => {
    window.__notely.useReview.setState({ notebook: null, loaded: false, states: {} });
    await window.__notely.useReview.getState().load(n.notebook);
  }, nb);
  const reloaded = await evaluate(() => Object.keys(window.__notely.useReview.getState().states).length);
  c.ok("progress is saved to the notebook", reloaded === nb.cards);

  // Clean up the test highlights.
  await evaluate((n) => n.ids.forEach((id) => window.__notely.useHighlights.getState().remove(n.notebook, n.pdf, id)), nb);
  await wait(800);
  return c;
}
