// Tabs: several notes/PDFs stay open per pane; switch, close, reorder, move
// between panes; positions and the layout are remembered.
import { checks } from "./harness.mjs";

export const name = "tabs";

export async function run({ page, evaluate, wait }) {
  const c = checks();
  const tabs = (pane) => page.locator(`[data-pane="${pane}"] [role="tab"]`);
  const tabNames = async (pane) => (await tabs(pane).allInnerTexts()).map((t) => t.trim());
  const active = async (pane) => (await page.locator(`[data-pane="${pane}"] [role="tab"][aria-selected="true"]`).innerText()).trim();

  const nb = await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    const long = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join("\n\n");
    for (const [n, body] of [["Tab A", `# Tab A\n\n${long}\n`], ["Tab B", "# Tab B\n"], ["Tab C", "# Tab C\n"]]) {
      if (!V().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === n)) await V().createNote(n, body);
    }
    window.__notely.useWorkspace.getState().setLayout([null, null], 0);
    return "Beta";
  });
  await wait(600);

  // Open three notes from the sidebar.
  for (const n of ["Tab A", "Tab B", "Tab C"]) {
    await page.locator(`aside [data-sb-item][aria-label="note: ${n}"]`).click();
    await wait(350);
  }
  c.ok("opening notes from the sidebar adds tabs", JSON.stringify(await tabNames(0)) === JSON.stringify(["Tab A", "Tab B", "Tab C"]));
  c.ok("the newest tab is active", (await active(0)) === "Tab C");

  // Scroll down in Tab A, switch away and back: position is kept.
  await tabs(0).nth(0).click();
  await wait(700);
  await evaluate(() => (document.querySelector('[data-pane="0"] .overflow-y-auto').scrollTop = 900));
  await wait(200);
  await tabs(0).nth(1).click();
  await wait(500);
  await tabs(0).nth(0).click();
  await wait(900);
  const top = await evaluate(() => document.querySelector('[data-pane="0"] .overflow-y-auto').scrollTop);
  c.ok("switching back to a note restores its scroll position", Math.abs(top - 900) < 40);

  // Ctrl+Tab cycles.
  await page.locator('[data-pane="0"] .cm-content').click();
  await page.keyboard.press("Control+Tab");
  await wait(400);
  c.ok("Ctrl+Tab moves to the next tab", (await active(0)) === "Tab B");

  // Drag Tab C before Tab A.
  await tabs(0).nth(2).dragTo(tabs(0).nth(0), { targetPosition: { x: 5, y: 10 } });
  await wait(400);
  c.ok("dragging a tab reorders it", JSON.stringify(await tabNames(0)) === JSON.stringify(["Tab C", "Tab A", "Tab B"]));

  // Right-click → move to the right pane.
  await tabs(0).nth(2).click({ button: "right" });
  await page.getByText("Move to the right pane").click();
  await wait(700);
  c.ok("a tab can be moved to the other pane", JSON.stringify(await tabNames(1)) === JSON.stringify(["Tab B"]) && (await tabNames(0)).length === 2);

  // Middle-click closes.
  await tabs(0).nth(0).click({ button: "middle" });
  await wait(400);
  c.ok("middle-click closes a tab", JSON.stringify(await tabNames(0)) === JSON.stringify(["Tab A"]));

  // Ctrl+W on the last tab of the left pane: the right pane slides over.
  await tabs(0).nth(0).click();
  await page.keyboard.press("Control+w");
  await wait(500);
  c.ok("closing a pane's last tab lets the other pane take its place", JSON.stringify(await tabNames(0)) === JSON.stringify(["Tab B"]) && (await tabs(1).count()) === 0);

  // The tab layout survives a notebook switch.
  await evaluate(async () => {
    window.__notely.useWorkspace.getState().open({ kind: "note", name: "Tab A" });
    window.__notely.useWorkspace.getState().open({ kind: "note", name: "Tab C" });
  });
  await wait(1500); // layout saves are debounced
  await evaluate(async (n) => {
    const V = window.__notely.useVault.getState();
    const otherNb = V.notebooks.find((x) => x.name !== n).name;
    await V.setActiveNotebook(otherNb);
    await window.__notely.useVault.getState().setActiveNotebook(n);
  }, nb);
  await wait(900);
  c.ok("tabs are restored when you come back to the notebook", JSON.stringify(await tabNames(0)) === JSON.stringify(["Tab B", "Tab A", "Tab C"]));

  // Snap: drag a tab onto the right half of the workspace to split the view.
  await evaluate(() => {
    const ws = window.__notely.useWorkspace.getState();
    ws.setLayout([null, null], 0);
    ws.open({ kind: "note", name: "Tab A" });
    ws.open({ kind: "note", name: "Tab B" });
  });
  await wait(500);
  // Manual drag (the snap overlay only mounts once the drag starts, so dragTo,
  // which resolves its target up front, can't be used here).
  const pane0 = await page.locator('[data-pane="0"]').boundingBox();
  const tA = await tabs(0).nth(0).boundingBox();
  await page.mouse.move(tA.x + tA.width / 2, tA.y + tA.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(tA.x + tA.width / 2 + i * ((pane0.x + pane0.width * 0.75 - tA.x) / 10), tA.y + i * 15, { steps: 2 });
    await wait(30);
  }
  await wait(200);
  await page.mouse.up();
  await wait(700);
  c.ok("dragging a tab to the right half splits the view", JSON.stringify(await tabNames(1)) === JSON.stringify(["Tab A"]) && JSON.stringify(await tabNames(0)) === JSON.stringify(["Tab B"]));

  return c;
}
