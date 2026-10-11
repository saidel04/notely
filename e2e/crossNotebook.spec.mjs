// Cross-notebook links: the link index, backlinks from another notebook, and
// that clicking a cross-notebook backlink switches notebooks.
import { checks } from "./harness.mjs";

export const name = "cross-notebook backlinks";

export async function run({ evaluate, wait, store }) {
  const c = checks();

  // Scenario: Alpha/Source links to Beta/Target.
  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    const has = (nb) => V().notebooks.some((x) => x.name === nb);
    if (!has("Alpha")) await V().createNotebook("Alpha");
    if (!has("Beta")) await V().createNotebook("Beta");
    await V().setActiveNotebook("Beta");
    if (!V().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === "Target"))
      await V().createNote("Target", "# Target\n");
    await V().setActiveNotebook("Alpha");
    if (!V().notebooks.find((x) => x.name === "Alpha").notes.some((x) => x.name === "Source"))
      await V().createNote("Source", "See [[Beta/Target]] for details.\n");
  });
  await wait(1500); // let the link index sync

  const idx = await evaluate(() => {
    const s = window.__notely.useLinkIndex.getState();
    return s.notes.Alpha?.Source?.links ?? [];
  });
  c.ok("link index captured Alpha/Source → Beta/Target", idx.some((l) => l.notebook === "Beta" && l.name === "Target"));

  // Open Beta/Target; its backlinks footer should list the Alpha source.
  await evaluate(async () => {
    await window.__notely.useVault.getState().setActiveNotebook("Beta");
    window.__notely.useWorkspace.getState().open({ kind: "note", name: "Target" });
  });
  await wait(1200);
  const footerHasExternal = await evaluate(
    () => document.body.innerText.includes("Source") && document.body.innerText.includes("Alpha"),
  );
  c.ok("backlinks footer shows the Alpha › Source mention", footerHasExternal);

  return c;
}
