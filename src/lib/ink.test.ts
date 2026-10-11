import { describe, expect, it } from "vitest";
import { normalizeCanvas, serializeCanvas, parseCanvas, fileNodeTarget, fileNodePath } from "./canvas";
import { drawingPoints, simplify, smoothPath, strokeNode } from "./ink";

describe("simplify", () => {
  it("drops points on a straight line and keeps corners", () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplify(line, 0.5)).toEqual([line[0], line[19]]);
    const corner = [...line, ...Array.from({ length: 10 }, (_, i) => ({ x: 19, y: i + 1 }))];
    expect(simplify(corner, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 10 }]);
  });
});

describe("smoothPath", () => {
  it("draws dots, lines and curves", () => {
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1,2 L1,2");
    expect(smoothPath([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe("M0,0 L5,5");
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe("M0,0 Q10,0 10,5 L10,10");
  });
});

describe("strokeNode", () => {
  const stroke = [
    { x: 100, y: 100 },
    { x: 140, y: 130 },
    { x: 180, y: 100 },
  ];

  it("hugs the stroke and stores points relative to the box", () => {
    const n = strokeNode(stroke, 4, "1")!;
    expect(n.type).toBe("drawing");
    expect(n.x).toBeLessThanOrEqual(100 - 2);
    expect(n.y).toBeLessThanOrEqual(100 - 2);
    expect(n.x + n.width).toBeGreaterThanOrEqual(182);
    expect(n.color).toBe("1");
    expect(n.viewWidth).toBe(n.width);
    // Back in world coordinates, the points are where they were drawn.
    const back = drawingPoints(n);
    expect(back[0].x).toBeCloseTo(100, 0);
    expect(back[1].y).toBeCloseTo(130, 0);
  });

  it("gives a straight line a box of at least the minimum size", () => {
    const n = strokeNode([{ x: 0, y: 50 }, { x: 200, y: 50 }], 2)!;
    expect(n.height).toBeGreaterThanOrEqual(20);
    expect(drawingPoints(n)[0].y).toBeCloseTo(50, 0);
  });

  it("scales with the node when it's resized", () => {
    const n = strokeNode(stroke, 4)!;
    const big = { ...n, width: n.width * 2, height: n.height * 2 };
    const pts = drawingPoints(big);
    expect(pts[2].x - pts[0].x).toBeCloseTo((180 - 100) * 2, 0);
  });

  it("survives a save and reload", () => {
    const n = strokeNode(stroke, 3)!;
    const { data } = parseCanvas(serializeCanvas({ nodes: [n], edges: [] }));
    expect(data.nodes[0]).toEqual(n);
  });

  it("is dropped when it has no points", () => {
    const { data } = normalizeCanvas({ nodes: [{ id: "d", type: "drawing", x: 0, y: 0, width: 30, height: 30, points: [] }] });
    expect(data.nodes).toHaveLength(0);
  });
});

describe("image cards", () => {
  it("are file nodes pointing into _assets", () => {
    const path = fileNodePath("Biology", "image", "cell p3@2x.png");
    expect(path).toBe("Biology/_assets/cell p3@2x.png");
    expect(fileNodeTarget(path, "Other")).toEqual({ kind: "image", name: "cell p3@2x.png", notebook: "Biology" });
    expect(fileNodeTarget("_assets/a.jpg", "Biology")).toEqual({ kind: "image", name: "a.jpg", notebook: "Biology" });
    expect(fileNodeTarget("Biology/_assets/notes.txt", "Biology")).toBeNull();
  });
});
