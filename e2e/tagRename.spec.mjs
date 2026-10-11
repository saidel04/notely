// Renaming a tag rewrites it (and its nested tags) in every notebook's notes and
// canvases; renaming onto an existing tag merges them; a plain rename can be undone.
import { checks } from "./harness.mjs";

export const name = "rename & merge tags";

export async function run({ page, evaluate, wait }) {
  const c = checks();

  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    const fresh = async (nb, note, body) => {
      await V().setActiveNotebook(nb);
      if (V().notebooks.find((x) => x.name === nb).notes.some((x) => x.name === note)) await V().deleteNote(note);
      await V().createNote(note, body);
    };
    await fresh("Alpha", "Tag One", "Study for #e2eexam and #e2eexam/midterm.\n\n`#e2eexam` stays in code.\n");
    await fresh("Beta", "Tag Two", "Also #E2EExam here, plus #e2etest.\n");
    // A canvas card with the tag (Beta is active, so this is the live canvas).
    if (V().notebooks.find((x) => x.name === "Beta").canvases.some((x) => x.name === "Tag Canvas")) await V().deleteCanvas("Tag Canvas");
    await V().createCanvas("Tag Canvas", JSON.stringify({ nodes: [{ id: "t1", type: "text", x: 0, y: 0, width: 200, height: 60, text: "Card #e2eexam" }], edges: [] }));
    window.__notely.useUi.setState({ toasts: [] });
  });
  await wait(1500);

  // Rename through the sidebar: right-click the tag → Rename tag… → type → Enter.
  await page.locator("aside button", { hasText: /^#e2eexam/i }).first().click({ button: "right" });
  await page.getByText("Rename tag…").click();
  await wait(300);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("e2eboard");
  await page.keyboard.press("Enter");
  await wait(2500);

  const read = () =>
    evaluate(async () => {
      const api = (await import("/src/lib/vault.ts")).vaultApi;
      const canvas = window.__notely.useCanvases.getState().data["Tag Canvas"];
      return {
        one: await api.readNote("Alpha", "Tag One"),
        two: window.__notely.useVault.getState().contents["Tag Two"],
        card: canvas?.nodes[0]?.text,
      };
    });
  let s = await read();
  c.ok("renamed in another notebook, nested tag included", s.one.includes("#e2eboard and #e2eboard/midterm"));
  c.ok("tags in code are left alone", s.one.includes("`#e2eexam`"));
  c.ok("renamed in the open notebook (any capitalization)", s.two.includes("Also #e2eboard here"));
  c.ok("renamed inside canvas cards", s.card === "Card #e2eboard");
  const toast = await evaluate(() => window.__notely.useUi.getState().toasts.find((t) => t.action?.label === "Undo")?.message ?? "");
  c.ok("toast reports the change and offers Undo", /Renamed #e2eexam to #e2eboard in 2 notes and 1 canvas/i.test(toast));

  const undo = () => evaluate(() => [...window.__notely.useUi.getState().toasts].reverse().find((t) => t.action?.label === "Undo")?.action.run());

  // Undo puts everything back exactly — original capitalization included.
  await undo();
  await wait(2500);
  s = await read();
  c.ok(
    "undo restores every file exactly",
    s.one === "Study for #e2eexam and #e2eexam/midterm.\n\n`#e2eexam` stays in code.\n" && s.two === "Also #E2EExam here, plus #e2etest.\n" && s.card === "Card #e2eexam",
  );

  // Merge #e2eexam into the existing #e2etest — and undo that too.
  await evaluate(() => window.__notely.useUi.setState({ toasts: [] }));
  await evaluate(() => window.__notely.useVault.getState().renameTag("e2eexam", "e2etest"));
  await wait(1500);
  s = await read();
  const merged = await evaluate(() => window.__notely.useUi.getState().toasts.map((t) => [t.message, !!t.action]));
  c.ok("merging onto an existing tag joins them", s.two.includes("Also #e2etest here, plus #e2etest.") && s.one.includes("#e2etest/midterm"));
  c.ok("a merge says so and can be undone", merged.some(([m, a]) => /^Merged #e2eexam into #e2etest/.test(m) && a));

  // Edit one file after the merge: undo restores the others but leaves that one alone.
  await evaluate(async () => {
    const api = (await import("/src/lib/vault.ts")).vaultApi;
    await api.writeNote("Alpha", "Tag One", "Rewritten by hand #e2etest\n");
  });
  await wait(800);
  await undo();
  await wait(2500);
  s = await read();
  const notes = await evaluate(() => window.__notely.useUi.getState().toasts.map((t) => t.message));
  c.ok("undo skips files edited since (and says so)", s.one === "Rewritten by hand #e2etest\n" && s.two === "Also #E2EExam here, plus #e2etest.\n" && notes.some((m) => /1 file was edited since/.test(m)));

  return c;
}
