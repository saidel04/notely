import { describe, expect, it } from "vitest";
import type { CanvasData } from "./canvas";
import { applyPatch, canvasHistory, deepEqual, diffCanvas } from "./canvasHistory";

const text = (id: string, x: number, label = id): CanvasData["nodes"][number] => ({
  id,
  type: "text",
  x,
  y: 0,
  width: 100,
  height: 40,
  text: label,
});

const canvas = (nodes: CanvasData["nodes"], edges: CanvasData["edges"] = []): CanvasData => ({ nodes, edges });

describe("deepEqual", () => {
  it("ignores undefined fields", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
  });
});

describe("diff + apply", () => {
  it("undo reverts a moved node", () => {
    const before = canvas([text("a", 0), text("b", 100)]);
    const after = canvas([text("a", 50), text("b", 100)]);
    const patch = diffCanvas(before, after);
    expect(patch.nodes).toHaveLength(1);
    expect(applyPatch(after, patch, true)).toEqual(before);
    expect(applyPatch(before, patch, false)).toEqual(after);
  });

  it("re-adds a removed node at its original index", () => {
    const before = canvas([text("a", 0), text("b", 100), text("c", 200)]);
    const after = canvas([text("a", 0), text("c", 200)]);
    const undone = applyPatch(after, diffCanvas(before, after), true);
    expect(undone.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("history keeps concurrent edits", () => {
  it("undo does not revert a node an agent changed meanwhile", () => {
    canvasHistory.forget("nb", "c");
    const before = canvas([text("a", 0), text("b", 100)]);
    const after = canvas([text("a", 50), text("b", 100)]); // user moved "a"
    canvasHistory.record("nb", "c", before, after);

    // Meanwhile an agent moves "b".
    const concurrent = canvas([text("a", 50), text("b", 999)]);
    const undone = canvasHistory.undo("nb", "c", concurrent)!;

    expect(undone.nodes.find((n) => n.id === "a")!.x).toBe(0); // user's move undone
    expect(undone.nodes.find((n) => n.id === "b")!.x).toBe(999); // agent's move kept
  });

  it("drops an edge whose endpoint was removed elsewhere", () => {
    canvasHistory.forget("nb", "c2");
    const before = canvas([text("a", 0)]);
    const after = canvas([text("a", 50)]);
    canvasHistory.record("nb", "c2", before, after);
    // Node "a" was deleted by someone else; undoing the move must not resurrect a dangling edge.
    const now = canvas([text("a", 50)], [{ id: "e1", fromNode: "a", toNode: "ghost" }]);
    const undone = canvasHistory.undo("nb", "c2", now)!;
    expect(undone.edges).toHaveLength(0);
  });

  it("redo reapplies after undo", () => {
    canvasHistory.forget("nb", "c3");
    const before = canvas([text("a", 0)]);
    const after = canvas([text("a", 50)]);
    canvasHistory.record("nb", "c3", before, after);
    const undone = canvasHistory.undo("nb", "c3", after)!;
    expect(undone.nodes[0].x).toBe(0);
    const redone = canvasHistory.redo("nb", "c3", undone)!;
    expect(redone.nodes[0].x).toBe(50);
  });
});
