// Images in notes use plain Markdown, `![alt](_assets/name.png)`, with the file
// stored in the notebook's `_assets/` folder — so notes stay readable in any
// Markdown app. Pure helpers only (no IO), shared by the editor and tests.

export const ASSET_DIR = "_assets";

const EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

export interface ImageRef {
  alt: string;
  /** As written in the Markdown. */
  path: string;
  /** File name inside `_assets/`, or null for anything else (e.g. a web URL). */
  asset: string | null;
  /** The optional `"title"`; for PDF figures it holds the [[link]] to the source page. */
  title?: string;
}

// ![alt](path)  ![alt](<path with spaces>)  ![alt](path "title")
const IMAGE_LINE = /^\s*!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"([^"\n]*)")?\s*\)\s*$/;

export const isImagePath = (p: string) => EXTS.includes(p.split(".").pop()?.toLowerCase() ?? "");

/** If `text` (one line) is nothing but an image, returns it. */
export function imageOnLine(text: string): ImageRef | null {
  const m = IMAGE_LINE.exec(text);
  if (!m) return null;
  const path = (m[2] ?? m[3]).trim();
  const inAssets = path.startsWith(`${ASSET_DIR}/`) && !path.slice(ASSET_DIR.length + 1).includes("/");
  let asset: string | null = null;
  if (inAssets) {
    try {
      asset = decodeURI(path.slice(ASSET_DIR.length + 1));
    } catch {
      asset = path.slice(ASSET_DIR.length + 1);
    }
  }
  return { alt: m[1].trim(), path, asset, ...(m[4]?.trim() ? { title: m[4].trim() } : {}) };
}

/** Markdown for an image in `_assets/` (angle brackets if the name needs them). */
export function imageMarkdown(name: string, alt = "", title?: string): string {
  const path = `${ASSET_DIR}/${name}`;
  const target = /[\s()<>]/.test(path) ? `<${path}>` : path;
  const t = title?.replace(/["\n]/g, "").trim();
  return `![${alt.replace(/[[\]\n]/g, "").trim()}](${target}${t ? ` "${t}"` : ""})`;
}

/**
 * The `@2x`-style pixel density in a file name (1 when there's none). A
 * de-duplication suffix may sit between the `@Nx` and the extension —
 * `fig@2x-2.png`, `fig@2x (2).png` — and still counts.
 */
export function pixelDensity(name: string): number {
  const m = /@(\d+(?:\.\d+)?)x(?:[-_ ]?\(?\d+\)?)?\.[a-z0-9]+$/i.exec(name);
  const d = m ? parseFloat(m[1]) : 1;
  return d >= 1 && d <= 8 ? d : 1;
}

/** File extension for a clipboard/drag image type (PNG when unknown). */
export const extForType = (type: string) => MIME_EXT[type.toLowerCase()] ?? "png";

export function mimeForName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg") return "image/jpeg";
  return Object.keys(MIME_EXT).find((k) => MIME_EXT[k] === ext) ?? "application/octet-stream";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "pasted-20261004-153012.png" — sortable and free of spaces. */
export function pastedImageName(type: string, now = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${stamp}.${extForType(type)}`;
}
