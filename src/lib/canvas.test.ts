import { describe, expect, it } from "vitest";
import { autoLayout, edgeGeometry, fileNodeTarget, loadCanvas, normalizeCanvas, serializeCanvas } from "./canvas";

describe("normalizeCanvas", () => {
  it("fills ids, sizes and types, and accepts agent-friendly aliases", () => {
    const { data, unplaced } = normalizeCanvas({
      nodes: [
        { id: "a", label: "Start", shape: "ellipse" },
        { id: "b", text: "Do work", x: 10, y: 20 },
        { file: "Bio/Cells.md" },
      ],
      edges: [
        { from: "a", to: "b", label: "go" },
        { from: "a", to: "missing" },
      ],
    });
    expect(data.nodes.map((n) => n.type)).toEqual(["text", "text", "file"]);
    expect(data.nodes[0]).toMatchObject({ text: "Start", shape: "ellipse" });
    expect(data.nodes[2].id).toBeTruthy();
    expect(data.nodes.every((n) => n.width >= 20 && n.height >= 20)).toBe(true);
    expect(unplaced.has("a")).toBe(true);
    expect(unplaced.has("b")).toBe(false);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]).toMatchObject({ fromNode: "a", toNode: "b", label: "go" });
  });

  it("drops invalid colors and keeps presets / hex", () => {
    const { data } = normalizeCanvas({ nodes: [{ id: "a", color: "4" }, { id: "b", color: "#ff0000" }, { id: "c", color: "red" }] });
    expect(data.nodes.map((n) => n.color)).toEqual(["4", "#ff0000", undefined]);
  });
});

describe("autoLayout", () => {
  it("places a chain top-to-bottom without overlaps", () => {
    const { data } = loadCanvas(
      JSON.stringify({ nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] }),
    );
    const [a, b, c] = data.nodes;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  });

  it("handles cycles and branches left-to-right", () => {
    const { data } = normalizeCanvas({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "c", to: "a" }],
    });
    const out = autoLayout(data, { direction: "LR" });
    const [a, b, c] = out.nodes;
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.x).toBeGreaterThan(a.x);
    expect(b.y).not.toBe(c.y);
  });
});

describe("incremental placement", () => {
  it("puts a new node below its parent without overlapping siblings", () => {
    const { data } = normalizeCanvas({
      nodes: [
        { id: "p", text: "Parent", x: 0, y: 0, width: 160, height: 60 },
        { id: "c1", text: "Existing child", x: 0, y: 150, width: 160, height: 60 },
        { id: "c2", text: "New child" },
      ],
      edges: [{ from: "p", to: "c1" }, { from: "p", to: "c2" }],
    });
    const out = autoLayout(data, { only: new Set(["c2"]) });
    const [p, c1, c2] = out.nodes;
    expect(p).toMatchObject({ x: 0, y: 0 });
    expect(c1).toMatchObject({ x: 0, y: 150 });
    expect(c2.y).toBe(p.y + p.height + 90);
    expect(c2.x + c2.width <= c1.x || c2.x >= c1.x + c1.width).toBe(true);
  });
});

describe("geometry & paths", () => {
  it("connects facing sides", () => {
    const a = { id: "a", type: "text" as const, text: "", x: 0, y: 0, width: 100, height: 50 };
    const b = { ...a, id: "b", y: 200 };
    const g = edgeGeometry(a, b, {});
    expect(g.start).toEqual({ x: 50, y: 50 });
    expect(g.end).toEqual({ x: 50, y: 200 });
  });

  it("resolves file nodes relative to the notebook", () => {
    expect(fileNodeTarget("Bio/Cells.md", "Bio")).toEqual({ kind: "note", name: "Cells", notebook: "Bio" });
    expect(fileNodeTarget("Cells.md", "Bio")).toEqual({ kind: "note", name: "Cells", notebook: "Bio" });
    expect(fileNodeTarget("Bio/_pdfs/p.pdf", "Bio")).toEqual({ kind: "pdf", name: "p.pdf", notebook: "Bio" });
    expect(fileNodeTarget("_pdfs/p.pdf", "Bio")).toEqual({ kind: "pdf", name: "p.pdf", notebook: "Bio" });
    expect(fileNodeTarget("Other/x.md", "Bio")).toEqual({ kind: "note", name: "x", notebook: "Other" });
    expect(fileNodeTarget("a/b/c.md", "Bio")).toBeNull();
  });

  it("round-trips through serialize", () => {
    const { data } = normalizeCanvas({ nodes: [{ id: "a", x: 1, y: 2, width: 30, height: 40, text: "hi" }], edges: [] });
    expect(loadCanvas(serializeCanvas(data)).data).toEqual(data);
  });
});
