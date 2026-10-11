import { imageMarkdown, mimeForName, pastedImageName } from "./images";
import { vaultApi } from "./vault";

// Loads `_assets/` images as blob URLs (the WebView can't read vault files
// directly) and saves new ones. URLs are cached for the session.

const urls = new Map<string, Promise<string>>();
const key = (notebook: string, name: string) => `${notebook}/${name}`.toLowerCase();

export function assetUrl(notebook: string, name: string): Promise<string> {
  const k = key(notebook, name);
  let hit = urls.get(k);
  if (!hit) {
    hit = vaultApi.readAsset(notebook, name).then((buf) => URL.createObjectURL(new Blob([buf], { type: mimeForName(name) })));
    // Don't cache failures: the file may appear later (e.g. synced in).
    hit.catch(() => urls.delete(k));
    urls.set(k, hit);
  }
  return hit;
}

/** Drops cached URLs (e.g. when switching vaults). */
export function clearAssetUrls() {
  for (const p of urls.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  urls.clear();
}

/** Saves an image blob into the notebook's `_assets/` and returns the file name it got. */
export async function saveImageFile(notebook: string, blob: Blob, nameHint?: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return vaultApi.writeAsset(notebook, nameHint ?? pastedImageName(blob.type), bytes);
}

/** Saves an image blob into the notebook and returns the Markdown that shows it. */
export async function saveImage(notebook: string, blob: Blob, nameHint?: string, alt = ""): Promise<string> {
  return imageMarkdown(await saveImageFile(notebook, blob, nameHint), alt);
}

/** Copies an image file from disk into the notebook and returns its Markdown. */
export async function importImage(notebook: string, path: string): Promise<string> {
  return imageMarkdown(await vaultApi.importAsset(notebook, path));
}
