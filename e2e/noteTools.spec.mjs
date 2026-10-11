// In-note tools: the heading outline, Ctrl+F find, and citations for the PDFs
// a note links to.
import { checks } from "./harness.mjs";

export const name = "outline, find & citations";

export async function run({ page, evaluate, wait }) {
  const c = checks();

  const setup = await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    const nb = V().notebooks.find((x) => x.pdfs.length);
    if (!nb) return null;
    await V().setActiveNotebook(nb.name);
    if (V().notebooks.find((x) => x.name === nb.name).notes.some((x) => x.name === "E2E Tools")) await V().deleteNote("E2E Tools");
    const pdf = nb.pdfs[0].name;
    const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about sieges and gates.`).join("\n\n");
    const body = `# Overview\n\nSee [[${pdf}#page=3]].\n\n## The gates\n\n${filler}\n\n## Watchmen\n\nThe watchmen rotate nightly.\n\n### Rotation\n\nGates again.\n`;
    await V().createNote("E2E Tools", body);
    window.__notely.useUi.setState({ outlineOpen: false, toasts: [] });
    window.__notely.useWorkspace.getState().setLayout([{ kind: "note", name: "E2E Tools" }, null], 0);
    return { notebook: nb.name, pdf };
  });
  if (!setup) {
    console.log("  (no PDF in the sandbox — skipping)");
    return c;
  }
  await wait(1300);

  // ---- outline ----
  await page.keyboard.press("Control+Shift+O");
  await wait(500);
  const items = await page.locator('nav[aria-label="Note outline"] li').allInnerTexts();
  c.ok("Ctrl+Shift+O shows the outline with every heading", JSON.stringify(items) === JSON.stringify(["Overview", "The gates", "Watchmen", "Rotation"]));

  await page.locator('nav[aria-label="Note outline"] button', { hasText: "Watchmen" }).click();
  await wait(700);
  const current = await page.locator('nav[aria-label="Note outline"] [aria-current="location"]').innerText();
  c.ok("clicking a heading jumps there and marks it current", current === "Watchmen");
  const cursorLine = await evaluate(() => {
    const sel = window.getSelection();
    return sel?.anchorNode?.parentElement?.closest(".cm-line")?.textContent ?? "";
  });
  c.ok("the cursor lands on that heading", cursorLine.includes("Watchmen"));

  // ---- find ----
  await page.keyboard.press("Control+f");
  await wait(400);
  c.ok("Ctrl+F opens the find bar in the note (not notebook search)", (await page.locator(".cm-search").count()) === 1 && (await evaluate(() => window.__notely.useUi.getState().palette)) === null);
  await page.keyboard.type("gates");
  await page.keyboard.press("Enter");
  await wait(400);
  c.ok("matches are highlighted", (await page.locator(".cm-searchMatch").count()) > 1);
  await page.keyboard.press("Escape");
  await wait(300);
  c.ok("Escape closes the find bar", (await page.locator(".cm-search").count()) === 0);

  // Ctrl+G still opens the link map from inside a note.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+g");
  await wait(800);
  c.ok("Ctrl+G still opens the link map", await evaluate(() => window.__notely.useWorkspace.getState().panes.some((p) => p?.kind === "graph")));
  await evaluate(() => window.__notely.useWorkspace.getState().setLayout([{ kind: "note", name: "E2E Tools" }, null], 0));
  await wait(900);

  // ---- citations ----
  // Capture clipboard writes instead of reading the clipboard (reading would
  // trigger a WebView permission prompt).
  await evaluate(() => {
    window.__copied = null;
    navigator.clipboard.writeText = async (t) => void (window.__copied = t);
  });
  await page.locator('[data-pane="0"] header').hover();
  await page.locator('[data-pane="0"] button[title="More"]').click();
  await page.getByRole("menuitem", { name: /Copy citations \(BibTeX\)/ }).or(page.getByText("Copy citations (BibTeX)")).first().click();
  await wait(2500);
  const bib = (await evaluate(() => window.__copied)) ?? "";
  c.ok("BibTeX entry copied for the cited PDF", /^@(book|misc)\{\w+,/.test(bib) && bib.includes(`note = {File: `));

  await page.locator('[data-pane="0"] header').hover();
  await page.locator('[data-pane="0"] button[title="More"]').click();
  await page.getByText("Add a References section").first().click();
  await wait(1500);
  const text = await evaluate(() => window.__notely.useVault.getState().contents["E2E Tools"] ?? "");
  // APA: "Authors (year). *Title*" when there's an author, or "*Title.* (n.d.)." without one.
  const refs = text.split("\n## References\n\n")[1] ?? "";
  c.ok("References section appended in APA style", /\*.+\*/.test(refs) && /\((\d{4}|n\.d\.)\)/.test(refs));

  await evaluate(() => window.__notely.useUi.setState({ outlineOpen: false }));
  return c;
}
