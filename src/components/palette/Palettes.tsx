import { CommandPalette } from "./CommandPalette";
import { NotebookSearch } from "./NotebookSearch";
import { TemplatePicker } from "./TemplatePicker";

// Bundled together and lazy-loaded (see App.tsx): the command palette and the
// notebook search pull in cmdk and the PDF text engine, which aren't needed
// until the user first opens a palette.
export default function Palettes() {
  return (
    <>
      <CommandPalette />
      <NotebookSearch />
      <TemplatePicker />
    </>
  );
}
