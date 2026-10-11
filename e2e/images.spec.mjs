// Pasting an image into a note saves it to the notebook's _assets folder,
// inserts Markdown for it, and renders it inline.
import { checks } from "./harness.mjs";

export const name = "images in notes";

export async function run({ page, evaluate, wait }) {
  const c = checks();

  await evaluate(async () => {
    const V = () => window.__notely.useVault.getState();
    await V().setActiveNotebook("Beta");
    if (V().notebooks.find((x) => x.name === "Beta").notes.some((x) => x.name === "E2E Images")) await V().deleteNote("E2E Images");
    await V().createNote("E2E Images", "Intro line\n");
    window.__notely.useUi.setState({ toasts: [] });
    window.__notely.useWorkspace.getState().setLayout([{ kind: "note", name: "E2E Images" }, null], 0);
  });
  await wait(1200);

  // Put the cursor at the end, then paste a generated PNG.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#4b5bd6";
    ctx.fillRect(0, 0, 120, 80);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
    document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await wait(1500);

  const text = await evaluate(() => window.__notely.useVault.getState().contents["E2E Images"] ?? "");
  const m = /!\[\]\(_assets\/(pasted-\d{8}-\d{6}(?:-\d+)?\.png)\)/.exec(text);
  c.ok("paste inserted ![](_assets/pasted-….png)", !!m);
  c.ok("image sits on its own line", /\n!\[\]\(_assets\/[^)]+\)\n/.test(text));

  // Move the cursor off the image line so it renders.
  await page.locator(".cm-content").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+Home");
  await wait(1200);
  const img = await evaluate(() => {
    const el = document.querySelector(".cm-image-embed img");
    return el ? { src: el.src.slice(0, 5), w: el.naturalWidth } : null;
  });
  c.ok("image renders inline from a blob URL", img?.src === "blob:" && img.w === 120);

  // Clicking the image reveals its Markdown for editing.
  await page.locator(".cm-image-embed").first().click();
  await wait(400);
  c.ok("clicking the image shows its Markdown", (await page.locator(".cm-image-embed").count()) === 0);

  return c;
}
