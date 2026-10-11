// Templates (vault-wide, in _templates/) and daily notes.
import fs from "node:fs";
import path from "node:path";
import { checks } from "./harness.mjs";

export const name = "templates & daily notes";

const pad = (n) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function run({ page, vault, evaluate, wait }) {
  const c = checks();
  const dir = path.join(vault, "_templates");
  fs.rmSync(dir, { recursive: true, force: true }); // start without templates (sandbox only)

  await evaluate(async (t) => {
    window.__notely.useUi.getState().closePrompt(null); // nothing left open from an earlier run
    window.__notely.useUi.getState().openPalette(null);
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    for (const n of [`Lecture notes ${t}`, "Cell division", t]) {
      if (V().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === n)) await V().deleteNote(n);
    }
    window.__notely.useWorkspace.getState().setLayout([null, null], 0);
  }, today());
  await wait(800);

  // Sidebar → "New note from template"
  await page.locator("aside").hover();
  await page.locator('aside button[aria-label="New note from template"]').click();
  await wait(1200);
  const listed = await page.locator("[cmdk-item]").allInnerTexts();
  c.ok("starter templates are created and listed", ["Daily note", "Lecture notes", "Reading notes"].every((t) => listed.some((l) => l.startsWith(t))));
  c.ok("the _templates folder now exists on disk", fs.existsSync(path.join(dir, "Lecture notes.md")));

  await page.locator("[cmdk-item]", { hasText: "Lecture notes" }).click();
  await wait(1500);
  const created = await evaluate((t) => window.__notely.useVault.getState().contents[`Lecture notes ${t}`] ?? null, today());
  c.ok("a note is created from the template with placeholders filled", !!created && created.includes(`**Date:** ${today()}`) && !created.includes("{{"));

  // The title is selected for naming; Enter then drops you at {{cursor}}.
  await page.keyboard.type("Cell division");
  await page.keyboard.press("Enter");
  await wait(1200);
  await page.keyboard.type("Mitosis");
  await wait(1200);
  const renamed = await evaluate(() => window.__notely.useVault.getState().contents["Cell division"] ?? "");
  c.ok("you name the note first, then type where {{cursor}} was", renamed.startsWith("**Course:**") && renamed.includes("## Key ideas\n\n- Mitosis"));

  // Today's note: created once, then reopened.
  await page.keyboard.press("Control+Shift+D");
  await wait(1500);
  const daily = await evaluate((t) => window.__notely.useVault.getState().contents[t] ?? null, today());
  c.ok("Ctrl+Shift+D creates today's note from the Daily note template", !!daily && /^# \w+day, \d+ \w+ \d{4}/.test(daily));
  await page.keyboard.press("Control+Shift+D");
  await wait(800);
  const count = await evaluate((t) => window.__notely.useVault.getState().notebooks.find((x) => x.name === "Beta").notes.filter((n) => n.name.startsWith(t)).length, today());
  c.ok("pressing it again reopens the same note", count === 1);

  // Save a note as a template.
  // Not awaited: it waits for the name we type next.
  await evaluate(() => void import("/src/lib/templateActions.ts").then((m) => m.templates.saveNote("Cell division")));
  await wait(400);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Biology lecture");
  await page.keyboard.press("Enter");
  await wait(900);
  c.ok("a note can be saved as a template", fs.readFileSync(path.join(dir, "Biology lecture.md"), "utf8").includes("- Mitosis"));

  return c;
}
