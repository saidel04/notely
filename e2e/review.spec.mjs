// Flashcards: a `.cards` deck is a file of "Question: answer" lines, cards flip
// when clicked, and answers are scheduled with spaced repetition.
import { checks } from "./harness.mjs";

export const name = "flashcards";

const DECK = "E2E deck";
const CARDS = [
  ["What must the defenders guard?", "The gates, at night"],
  ["How are watchmen chosen?", "By lot, each evening"],
  ["Who keeps the keys?", "The castellan"],
];
const TEXT = `# a comment line, not a card\n${CARDS.map(([q, a]) => `${q}: ${a}`).join("\n")}\n`;

export async function run({ page, evaluate, wait }) {
  const c = checks();

  // A deck written straight to disk, as the user (or an agent) would.
  const nb = await evaluate(async (deck) => {
    const V = window.__notely.useVault.getState();
    const n = V.notebooks[0];
    if (!n) return null;
    await V.setActiveNotebook(n.name);
    // Leave no overlay open and no deck behind from an earlier run.
    window.__notely.useUi.setState({ review: null, palette: null, history: null });
    for (const d of n.decks.filter((x) => x.name.startsWith(deck.DECK))) {
      await window.__notely.useVault.getState().deleteDeck(d.name);
    }
    const name = await window.__notely.useVault.getState().createDeck(deck.DECK, deck.TEXT);
    await window.__notely.useReview.getState().load(n.name);
    window.__notely.useReview.setState({ states: {} });
    window.__notely.useWorkspace.getState().setLayout([null, null], 0);
    return { notebook: n.name, deck: name, cards: deck.CARDS.length };
  }, { DECK, TEXT, CARDS });
  if (!nb) {
    console.log("  (no notebook in the sandbox — skipping)");
    return c;
  }
  await wait(1200);

  // ----- the deck's own view -----

  await page.locator(`aside button[aria-label="deck: ${nb.deck}"]`).click();
  await wait(700);
  const faces = page.locator('button.card-flip');
  c.ok(`the deck shows ${nb.cards} cards`, (await faces.count()) === nb.cards);
  c.ok("the comment line is not a card", !(await page.getByText("a comment line").count()));

  const first = faces.first();
  c.ok("a card starts on its question", (await first.getAttribute("data-flipped")) === null);
  await first.click();
  await wait(500);
  c.ok("clicking a card flips it to the answer", (await first.getAttribute("data-flipped")) === "true");
  await first.click();
  await wait(500);
  c.ok("clicking again flips it back", (await first.getAttribute("data-flipped")) === null);

  // ----- review -----

  const badge = await page.locator('aside button[aria-label^="Review flashcards"]').getAttribute("aria-label");
  c.ok(`sidebar shows ${nb.cards} cards waiting`, badge === `Review flashcards, ${nb.cards} waiting`);

  await page.locator('aside button[aria-label^="Review flashcards"]').click();
  await wait(1000);
  c.ok("review opens with a card", (await page.getByRole("button", { name: /Show answer/ }).count()) === 1);

  const under = page.locator('[role="dialog"] button.card-flip');
  await under.click();
  await wait(500);
  c.ok("clicking the card under review reveals the answer", (await under.getAttribute("data-flipped")) === "true");
  c.ok("the answer buttons appear", (await page.getByRole("button", { name: /^Good/ }).count()) === 1);

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

  // Editing an answer keeps the card's schedule; rewriting a question makes a new card.
  await evaluate(async (n) => {
    window.__notely.useDecks.getState().set(n.deck, "What must the defenders guard?: The gates, always\n");
  }, nb);
  await wait(900);
  const afterEdit = await evaluate(() => Object.keys(window.__notely.useReview.getState().states).length);
  c.ok("progress is keyed to the question, not the answer", afterEdit === nb.cards);

  await evaluate(async (n) => await window.__notely.useVault.getState().deleteDeck(n.deck), nb);
  await wait(800);
  return c;
}
