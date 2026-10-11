import { save } from "@tauri-apps/plugin-dialog";
import { toBlob, toSvg } from "html-to-image";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bounds, CanvasData } from "../../lib/canvas";
import { errorMessage, vaultApi } from "../../lib/vault";
import { useUi } from "../../store/uiStore";
import { CanvasScene } from "./CanvasScene";

const PAD = 40;
/** Largest side of an exported PNG, in pixels (keeps huge canvases from failing). */
const MAX_PNG_SIDE = 12000;

const toast = (m: string, tone?: "info" | "error") => useUi.getState().toast(m, tone);

/** Everything drawn, including group labels above their box and edge labels. */
function contentBox(data: CanvasData) {
  const b = bounds(data.nodes);
  const top = data.nodes.some((n) => n.type === "group" && n.label) ? 24 : 0;
  return { x: b.x - PAD, y: b.y - PAD - top, width: b.width + PAD * 2, height: b.height + PAD * 2 + top };
}

/**
 * Draws the canvas (no selection, grid or toolbars) offscreen and captures it.
 * Text boxes are HTML inside the SVG, so styles and images are inlined by
 * html-to-image; the SVG opens in any browser and the PNG anywhere.
 */
async function render<T>(data: CanvasData, notebook: string, capture: (el: HTMLElement, box: { width: number; height: number }) => Promise<T>) {
  const box = contentBox(data);
  const host = document.createElement("div");
  // Offscreen but laid out, so fonts and sizes resolve like on screen.
  host.style.cssText = `position:fixed;left:-${box.width + 1000}px;top:0;width:${box.width}px;height:${box.height}px;pointer-events:none`;
  const stage = document.createElement("div");
  stage.className = "cv-export";
  stage.style.cssText = `width:${box.width}px;height:${box.height}px;background:var(--bg)`;
  host.append(stage);
  document.body.append(host);
  const root = createRoot(stage);
  try {
    flushSync(() =>
      root.render(
        <svg xmlns="http://www.w3.org/2000/svg" width={box.width} height={box.height} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
          <CanvasScene data={data} notebook={notebook} />
        </svg>,
      ),
    );
    // Images load asynchronously; wait (briefly) until none is still loading.
    for (let i = 0; i < 60 && stage.querySelector("[data-loading]"); i++) await new Promise((r) => setTimeout(r, 50));
    await document.fonts.ready;
    return await capture(stage, box);
  } finally {
    root.unmount();
    host.remove();
  }
}

const background = () => getComputedStyle(document.body).backgroundColor || "#ffffff";

async function pickPath(name: string, ext: "png" | "svg") {
  return save({
    title: `Export canvas as ${ext.toUpperCase()}`,
    defaultPath: `${name.replace(/[\\/:*?"<>|]/g, "")}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
}

/** Draws the canvas and writes it to `path`, no dialog. Used by the e2e suite. */
export async function exportCanvasToPath(data: CanvasData, notebook: string, format: "png" | "svg", path: string) {
  await writeExport(data, notebook, format, path);
}

async function writeExport(data: CanvasData, notebook: string, format: "png" | "svg", path: string) {
  if (format === "png") {
    const blob = await render(data, notebook, (el, box) => {
      const ratio = Math.max(0.25, Math.min(2, MAX_PNG_SIDE / Math.max(box.width, box.height)));
      return toBlob(el, { pixelRatio: ratio, backgroundColor: background(), cacheBust: false });
    });
    if (!blob) throw new Error("Couldn't draw the canvas");
    await vaultApi.exportBytes(path, new Uint8Array(await blob.arrayBuffer()));
  } else {
    const url = await render(data, notebook, (el) => toSvg(el, { backgroundColor: background() }));
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    await vaultApi.exportFile(path, svg);
  }
}

export async function exportCanvas(data: CanvasData, notebook: string, name: string, format: "png" | "svg") {
  if (!data.nodes.length) return toast("This canvas is empty");
  const path = await pickPath(name, format);
  if (!path) return;
  try {
    await writeExport(data, notebook, format, path);
    toast(`Exported to ${path.split(/[\\/]/).pop()}`);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}
