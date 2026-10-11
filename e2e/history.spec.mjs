// Version history: earlier versions are kept, compared and restored.
import fs from "node:fs";
import path from "node:path";
import { checks } from "./harness.mjs";

export const name = "version history";

export async function run({ page, vault, evaluate, wait }) {
  const c = checks();
  // History survives deleting a note (so undoing a delete keeps it); clear the last run's.
  for (const n of ["History note", "History renamed"]) fs.rmSync(path.join(vault, "Beta", ".notely", "history", n), { recursive: true, force: true });
  const api = (fn, arg) => evaluate(async ({ fn, arg }) => (await import("/src/lib/vault.ts")).vaultApi[fn](...arg), { fn, arg });

  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    for (const n of ["History note", "History renamed"]) if (V().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === n)) await V().deleteNote(n);
    window.__notely.useWorkspace.getState().setLayout([null, null], 0);
  });
  await wait(400);
  await api("createNote", ["Beta", "History note", "Line one\nLine two\n"]);
  // The first save after creating keeps the original as a version; quick re-saves don't add more.
  await api("writeNote", ["Beta", "History note", "Line one\nLine 2 changed\nLine three\n"]);
  await api("writeNote", ["Beta", "History note", "Line one\nLine 2 changed\nLine three\nLine four\n"]);
  let versions = await api("listVersions", ["Beta", "History note"]);
  c.ok("saving keeps one earlier version per editing session", versions.length === 1);

  await evaluate(async () => {
    await window.__notely.useVault.getState().refresh();
    await window.__notely.useVault.getState().reloadContents(false);
    window.__notely.useWorkspace.getState().open({ kind: "note", name: "History note" });
  });
  await wait(1200);

  // Open from the note's "…" menu.
  await page.locator('[data-pane="0"] header').hover();
  await page.locator('[data-pane="0"] button[title="More"]').click();
  await page.getByText("Version history…").click();
  await wait(1200);
  c.ok("the panel lists the version", (await page.locator('[role="option"]').count()) === 1);
  const diffText = await page.locator('[role="dialog"]').innerText();
  c.ok("it shows what changed since", diffText.includes("+3") && diffText.includes("−1") && diffText.includes("Line two"));

  await page.getByRole("button", { name: /Restore this version/ }).click();
  await wait(1500);
  const restored = await evaluate(() => window.__notely.useVault.getState().contents["History note"]);
  c.ok("restoring puts the old text back", restored === "Line one\nLine two\n");
  versions = await api("listVersions", ["Beta", "History note"]);
  const kept = await api("readVersion", ["Beta", "History note", versions[0].time]);
  c.ok("the text from before the restore is kept as a version", versions.length === 2 && kept.includes("Line four"));

  await page.locator('[data-pane="0"] .cm-content').click();
  await page.keyboard.press("Control+z");
  await wait(900);
  c.ok("Ctrl+Z undoes a restore", (await evaluate(() => window.__notely.useVault.getState().contents["History note"])).includes("Line four"));

  await evaluate(() => window.__notely.useVault.getState().renameNote("History note", "History renamed"));
  await wait(800);
  c.ok("history moves with a renamed note", (await api("listVersions", ["Beta", "History renamed"])).length === 2);

  return c;
}
