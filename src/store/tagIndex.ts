import { useMemo } from "react";
import { CanvasData, canvasText } from "../lib/canvas";
import { hasTag, tagKey, tagsIn } from "../lib/tags";
import { useCanvases } from "./canvasStore";
import { useVault } from "./vaultStore";

export interface TagInfo {
  key: string;
  name: string;
  notes: string[];
  canvases: string[];
}

export function buildTagIndex(contents: Record<string, string>, canvases: Record<string, CanvasData>): TagInfo[] {
  const index = new Map<string, TagInfo>();
  const add = (text: string, kind: "notes" | "canvases", item: string) => {
    for (const [key, name] of tagsIn(text)) {
      const info = index.get(key) ?? { key, name, notes: [], canvases: [] };
      info[kind].push(item);
      index.set(key, info);
    }
  };
  Object.entries(contents).forEach(([n, text]) => add(text, "notes", n));
  Object.entries(canvases).forEach(([c, data]) => add(canvasText(data), "canvases", c));
  return [...index.values()].sort((a, b) => b.notes.length + b.canvases.length - (a.notes.length + a.canvases.length) || a.name.localeCompare(b.name));
}

/** All tags of the active notebook, most used first. */
export function useTagIndex() {
  const contents = useVault((s) => s.contents);
  const canvases = useCanvases((s) => s.data);
  return useMemo(() => buildTagIndex(contents, canvases), [contents, canvases]);
}

/** Notes and canvases carrying `tag` (or a nested child of it). */
export function useTagged(tag: string | null) {
  const contents = useVault((s) => s.contents);
  const canvases = useCanvases((s) => s.data);
  return useMemo(() => {
    if (!tag) return null;
    return {
      notes: new Set(Object.entries(contents).filter(([, t]) => hasTag(tagsIn(t), tag)).map(([n]) => n)),
      canvases: new Set(Object.entries(canvases).filter(([, d]) => hasTag(tagsIn(canvasText(d)), tag)).map(([n]) => n)),
    };
  }, [tag, contents, canvases]);
}

export const sameTag = (a: string, b: string) => tagKey(a) === tagKey(b);
