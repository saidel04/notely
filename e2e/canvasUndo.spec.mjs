// Canvas undo is per-element: undoing the user's change keeps a concurrent edit
// (e.g. one an agent made) instead of rolling the whole document back.
import { checks } from "./harness.mjs";

export const name = "canvas undo keeps concurrent edits";

export async function run({ page, evaluate, wait }) {
  const c = checks();

  // Fresh canvas so history starts clean.
  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    if (V().notebooks.find((x) => x.name === "Beta").canvases.some((c) => c.name === "E2E"))
      await V().deleteCanvas("E2E");
  });
  await wait(400);
  await evaluate(() => window.__notely.useVault.getState().createCanvas("E2E"));
  await wait(500);
  await evaluate(() => window.__notely.useWorkspace.getState().open({ kind: "canvas", name: "E2E" }));
  await wait(1200);

  // Add a node by double-clicking the canvas, then typing.
  const cv = page.locator(".cv").first();
  const b = await cv.boundingBox();
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  await wait(400);
  await page.keyboard.type("Node A");
  await page.keyboard.press("Escape");
  await wait(700);
  const added = await evaluate(() => (window.__notely.useCanvases.getState().data.E2E?.nodes ?? []).length);
  c.ok("double-click added a node", added === 1);

  // A concurrent "agent" node arrives from outside the component.
  await evaluate(() => {
    const cs = window.__notely.useCanvases.getState();
    const d = cs.data.E2E;
    cs.set("E2E", { ...d, nodes: [...d.nodes, { id: "agent1", type: "text", x: 400, y: 0, width: 120, height: 48, text: "Agent" }] });
  });
  await wait(500);

  // Undo the user's add — must drop Node A but keep agent1.
  await cv.click({ position: { x: 15, y: 15 } });
  await page.keyboard.press("Control+z");
  await wait(700);
  const ids = await evaluate(() => (window.__notely.useCanvases.getState().data.E2E?.nodes ?? []).map((x) => x.id));
  c.ok("undo kept the concurrent agent node", ids.includes("agent1"));
  c.ok("undo removed only the user's node", ids.length === 1 && ids[0] === "agent1");

  await evaluate(() => window.__notely.useVault.getState().deleteCanvas("E2E"));
  await wait(300);
  return c;
}
