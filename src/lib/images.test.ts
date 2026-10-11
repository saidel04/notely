import { describe, expect, it } from "vitest";
import { extForType, imageMarkdown, imageOnLine, isImagePath, mimeForName, pastedImageName, pixelDensity } from "./images";

describe("imageOnLine", () => {
  it("recognizes an asset image alone on a line", () => {
    expect(imageOnLine("![Cell diagram](_assets/cell.png)")).toEqual({ alt: "Cell diagram", path: "_assets/cell.png", asset: "cell.png" });
    expect(imageOnLine("  ![](_assets/a.webp)  ")?.asset).toBe("a.webp");
  });

  it("accepts angle-bracket paths and titles", () => {
    expect(imageOnLine("![x](<_assets/my shot.png>)")?.asset).toBe("my shot.png");
    expect(imageOnLine('![x](_assets/a.png "A title")')?.asset).toBe("a.png");
    expect(imageOnLine("![x](_assets/my%20shot.png)")?.asset).toBe("my shot.png");
  });

  it("treats other paths as non-assets and rejects mixed lines", () => {
    expect(imageOnLine("![x](https://example.com/a.png)")).toEqual({ alt: "x", path: "https://example.com/a.png", asset: null });
    expect(imageOnLine("![x](_assets/sub/a.png)")?.asset).toBeNull();
    expect(imageOnLine("see ![x](_assets/a.png) here")).toBeNull();
    expect(imageOnLine("[not an image](_assets/a.png)")).toBeNull();
  });
});

describe("imageMarkdown", () => {
  it("round-trips through imageOnLine", () => {
    for (const name of ["shot.png", "my shot (2).png"]) {
      expect(imageOnLine(imageMarkdown(name, "Alt"))).toEqual({ alt: "Alt", path: expect.any(String), asset: name });
    }
  });

  it("strips characters that would break the alt text", () => {
    expect(imageMarkdown("a.png", "x [y]\nz")).toBe("![x yz](_assets/a.png)");
  });
});

describe("names and types", () => {
  it("builds sortable, space-free paste names", () => {
    expect(pastedImageName("image/png", new Date(2026, 9, 4, 15, 30, 12))).toBe("pasted-20261004-153012.png");
    expect(pastedImageName("image/jpeg", new Date(2026, 0, 1, 0, 0, 0))).toBe("pasted-20260101-000000.jpg");
  });

  it("reads @Nx pixel density from names", () => {
    expect(pixelDensity("_assets/Book-p3@3x.png")).toBe(3);
    expect(pixelDensity("shot@2x.PNG")).toBe(2);
    expect(pixelDensity("shot.png")).toBe(1);
    expect(pixelDensity("weird@0x.png")).toBe(1);
    // A de-duplication suffix after @Nx still counts.
    expect(pixelDensity("Book-p3@2x-4.png")).toBe(2);
    expect(pixelDensity("Book-p3@2x (2).png")).toBe(2);
  });

  it("maps types and names", () => {
    expect(extForType("image/svg+xml")).toBe("svg");
    expect(extForType("application/weird")).toBe("png");
    expect(mimeForName("a.SVG")).toBe("image/svg+xml");
    expect(mimeForName("a.jpg")).toBe("image/jpeg");
    expect(isImagePath("C:\\x\\Shot.PNG")).toBe(true);
    expect(isImagePath("notes.md")).toBe(false);
  });
});
