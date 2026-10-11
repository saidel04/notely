import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/settings", () => ({
  settings: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
  setSettingSoon: vi.fn(),
}));

const { useWorkspace, MAX_TABS } = await import("./workspaceStore");
const ws = () => useWorkspace.getState();
const note = (name: string) => ({ kind: "note" as const, name });
const names = (p: 0 | 1) => ws().tabs[p].items.map((i) => i.name);

beforeEach(() => ws().setLayout([null, null], 0));

describe("tabs", () => {
  it("opens items as tabs after the current one and shows the newest", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().activate(0, 0);
    ws().open(note("C"));
    expect(names(0)).toEqual(["A", "C", "B"]);
    expect(ws().panes[0]?.name).toBe("C");
  });

  it("switches to a tab that's already open instead of duplicating it", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().open(note("a")); // names match case-insensitively
    expect(names(0)).toEqual(["A", "B"]);
    expect(ws().panes[0]?.name).toBe("A");
  });

  it("opens to the side, moving the item so it's only open once", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().open(note("B"), { side: true });
    expect(names(0)).toEqual(["A"]);
    expect(names(1)).toEqual(["B"]);
    expect(ws().focused).toBe(1);
  });

  it("closing a tab shows its right neighbour; an emptied left pane takes the right one", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().open(note("C"));
    ws().activate(0, 1);
    ws().close(0);
    expect(names(0)).toEqual(["A", "C"]);
    expect(ws().panes[0]?.name).toBe("C");

    ws().setLayout([note("L"), note("R")], 0);
    ws().close(0);
    expect(names(0)).toEqual(["R"]);
    expect(names(1)).toEqual([]);
  });

  it("caps the number of tabs, dropping the oldest", () => {
    for (let i = 0; i < MAX_TABS + 3; i++) ws().open(note(`N${i}`));
    expect(names(0)).toHaveLength(MAX_TABS);
    expect(names(0)[0]).toBe("N3");
    expect(ws().panes[0]?.name).toBe(`N${MAX_TABS + 2}`);
  });

  it("moves tabs within and between panes, and cycles", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().open(note("C"));
    ws().moveTab(0, 2, 0, 0);
    expect(names(0)).toEqual(["C", "A", "B"]);
    ws().moveTab(0, 1, 1, 0);
    expect(names(0)).toEqual(["C", "B"]);
    expect(names(1)).toEqual(["A"]);
    ws().focus(0);
    ws().activate(0, 1);
    ws().cycle(1);
    expect(ws().panes[0]?.name).toBe("C");
  });

  it("renames and removes items across all tabs", () => {
    ws().setLayout([note("A"), note("B")], 0);
    ws().open(note("C"), { pane: 0 });
    ws().renameItem("note", "A", "Z");
    expect(names(0)).toEqual(["Z", "C"]);
    ws().removeItem("note", "B");
    expect(names(1)).toEqual([]);
  });

  it("keeps a link target through a rename but drops it once you switch tabs", () => {
    ws().open(note("A"));
    ws().open({ kind: "note", name: "B", target: { from: 5, to: 5, nonce: 1 } });
    ws().renameItem("note", "B", "B2");
    expect(ws().panes[0]).toMatchObject({ name: "B2", target: { from: 5 } });
    ws().activate(0, 0);
    ws().activate(0, 1);
    expect(ws().panes[0]).toEqual({ kind: "note", name: "B2" });
  });

  it("closes the other tabs in a pane", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().open(note("C"));
    ws().closeOthers(0, 1);
    expect(names(0)).toEqual(["B"]);
  });
});

describe("snapping a dragged tab", () => {
  it("splits a single pane, the tab taking the side it was dropped on", () => {
    ws().open(note("A"));
    ws().open(note("B"));
    ws().open(note("C"));
    ws().snap(0, 1, 1);
    expect(names(0)).toEqual(["A", "C"]);
    expect(names(1)).toEqual(["B"]);
    expect(ws().focused).toBe(1);

    ws().setLayout([null, null], 0);
    ws().open(note("A"));
    ws().open(note("B"));
    ws().snap(0, 1, 0);
    expect(names(0)).toEqual(["B"]);
    expect(names(1)).toEqual(["A"]);
    expect(ws().focused).toBe(0);
  });

  it("moves a tab to the other pane when the view is split", () => {
    ws().open(note("A"));
    ws().open(note("B"), { side: true });
    ws().open(note("C"), { pane: 1 });
    ws().snap(1, 0, 0);
    expect(names(0)).toEqual(["A", "B"]);
    expect(names(1)).toEqual(["C"]);
  });

  it("does nothing with a lone tab", () => {
    ws().open(note("A"));
    ws().snap(0, 0, 1);
    expect(names(0)).toEqual(["A"]);
    expect(names(1)).toEqual([]);
  });
});
