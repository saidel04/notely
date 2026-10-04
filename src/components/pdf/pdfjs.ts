import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Asset locations for scanned images (JBIG2/JPX), CJK text and non-embedded fonts. See scripts/copy-pdfjs.mjs. */
const base = new URL("/pdfjs/", window.location.origin).href;
export const pdfAssets = {
  wasmUrl: base + "wasm/",
  cMapUrl: base + "cmaps/",
  cMapPacked: true,
  standardFontDataUrl: base + "standard_fonts/",
  iccUrl: base + "iccs/",
};

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
