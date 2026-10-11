import { describe, expect, it } from "vitest";
import { captureScale, figureMarkdown, figureName, imageSource, regionFrom } from "./figure";
import { imageOnLine } from "./images";
import { parseLinks } from "./links";

const box = { left: 100, top: 50, width: 400, height: 600 };

describe("regionFrom", () => {
  it("normalizes a dragged box to the page, in either drag direction", () => {
    const r = regionFrom(3, { x: 300, y: 350 }, { x: 200, y: 200 }, box);
    expect(r.page).toBe(3);
    expect(r.x).toBeCloseTo(0.25);
    expect(r.y).toBeCloseTo(0.25);
    expect(r.w).toBeCloseTo(0.25);
    expect(r.h).toBeCloseTo(0.25);
  });

  it("clips to the page edges", () => {
    const r = regionFrom(1, { x: 0, y: 0 }, { x: 300, y: 2000 }, box);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBeCloseTo(0.5);
    expect(r.h).toBe(1);
  });
});

describe("figure output", () => {
  it("renders crisply but within bounds, at a whole-number scale", () => {
    expect(captureScale(1, 1)).toBe(2);
    expect(captureScale(1.5, 2)).toBe(3);
    expect(captureScale(1.2, 1.5)).toBe(2);
    expect(captureScale(5, 2)).toBe(4);
  });

  it("names figures after the PDF and page, recording the scale", () => {
    expect(figureName("Aineias the Tactician How to Survive (David Whitehead).pdf", 8, 3)).toBe("Aineias the Tactician How to Survive p8@3x.png");
    expect(figureName("(x).pdf", 2)).toBe("figure p2@2x.png");
  });

  it("is a single image line whose title links to the page", () => {
    const md = figureMarkdown("Book p8@2x.png", "Book.pdf", 8);
    expect(md).not.toContain("\n");
    const img = imageOnLine(md)!;
    expect(img.asset).toBe("Book p8@2x.png");
    expect(img.alt).toBe("Book, p. 8");
    const link = imageSource(img.title)!;
    expect(link.target).toBe("Book.pdf");
    expect(link.page).toBe(8);
    // The link is plain text in the note, so backlinks and renames find it.
    expect(parseLinks(md)).toHaveLength(1);
  });

  it("finds no source on ordinary images", () => {
    expect(imageSource(undefined)).toBeNull();
    expect(imageSource("A title")).toBeNull();
  });
});
