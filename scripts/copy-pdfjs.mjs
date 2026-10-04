// Copies the runtime assets pdf.js loads lazily (image decoders, CMaps, fonts)
// into public/ so they ship with the app. Runs before dev and build.
import { cpSync, existsSync, mkdirSync } from "node:fs";

const src = "node_modules/pdfjs-dist";
const dest = "public/pdfjs";
mkdirSync(dest, { recursive: true });
for (const dir of ["wasm", "cmaps", "standard_fonts", "iccs"]) {
  if (existsSync(`${src}/${dir}`)) cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true });
}
