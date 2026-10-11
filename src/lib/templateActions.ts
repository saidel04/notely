import { openPath } from "@tauri-apps/plugin-opener";
import { useUi } from "../store/uiStore";
import { findNotebook, useVault } from "../store/vaultStore";
import { freshNotes, nextNonce, useWorkspace } from "../store/workspaceStore";
import { sameName } from "./links";
import { applyTemplate, DAILY_TEMPLATE, isoDate, noteNameFor, STARTER_TEMPLATES } from "./templates";
import { errorMessage, validateName, vaultApi } from "./vault";

const toast = (m: string, tone?: "info" | "error") => useUi.getState().toast(m, tone);

/** Template names, writing the starter set the first time (if there's no `_templates/` folder yet). */
export async function listTemplates(): Promise<string[]> {
  let list = await vaultApi.listTemplates();
  if (list === null) {
    for (const [name, text] of Object.entries(STARTER_TEMPLATES)) await vaultApi.writeTemplate(name, text);
    list = (await vaultApi.listTemplates()) ?? [];
  }
  return list.map((t) => t.name).sort((a, b) => a.localeCompare(b));
}

/** Creates a note from `template` text and opens it with the cursor at {{cursor}}. */
async function createFrom(templateText: string, name: string, opts: { side?: boolean; nameIt?: boolean }) {
  const vault = useVault.getState();
  const notebook = vault.activeNotebook;
  if (!notebook) return;
  const now = new Date();
  let filled = applyTemplate(templateText, { title: name, notebook, now });
  const created = await vault.createNote(name, filled.text);
  if (!created) return;
  if (created !== name) {
    // The name was taken, so the note got a suffix; use the real name in the text.
    filled = applyTemplate(templateText, { title: created, notebook, now });
    await vaultApi.writeNote(notebook, created, filled.text);
    useVault.setState((s) => ({ contents: { ...s.contents, [created]: filled.text } }));
  }
  if (opts.nameIt) freshNotes.add(created);
  const at = filled.cursor ?? filled.text.length;
  useWorkspace.getState().open({ kind: "note", name: created, target: { from: at, to: at, nonce: nextNonce() } }, opts.side ? { side: true } : {});
}

export const templates = {
  /** New note from a template; its title is selected so you can name it. */
  async newNote(template: string, side = false) {
    try {
      const text = await vaultApi.readTemplate(template);
      await createFrom(text, noteNameFor(template, new Date()), { side, nameIt: true });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  /** Opens today's daily note in this notebook, creating it from the "Daily note" template. */
  async today() {
    const notebook = useVault.getState().activeNotebook;
    if (!notebook) return;
    const name = isoDate(new Date());
    const existing = findNotebook(notebook)?.notes.find((n) => sameName(n.name, name));
    if (existing) return useWorkspace.getState().open({ kind: "note", name: existing.name });
    try {
      const names = await listTemplates();
      const text = names.includes(DAILY_TEMPLATE) ? await vaultApi.readTemplate(DAILY_TEMPLATE) : STARTER_TEMPLATES[DAILY_TEMPLATE];
      await createFrom(text, name, {});
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  /** Saves a note's text as a template (replacing one with the same name). */
  async saveNote(note: string) {
    const name = await useUi.getState().ask({
      title: "Save as template",
      initial: note,
      placeholder: "Template name",
      confirmLabel: "Save template",
      validate: validateName,
    });
    if (!name) return;
    try {
      await listTemplates(); // make sure the folder (and starters) exist first
      await vaultApi.writeTemplate(name, useVault.getState().contents[note] ?? "");
      toast(`Saved template “${name}” — use {{title}}, {{date}} and {{cursor}} in it`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  async openFolder() {
    const vault = useVault.getState().vaultPath;
    if (!vault) return;
    try {
      await listTemplates();
      await openPath(`${vault.replace(/[\\/]+$/, "")}/_templates`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },
};
