import { describe, expect, it } from "vitest";
import { pageQuery } from "./links";

describe("pageQuery", () => {
  it("reads a PDF name followed by a page", () => {
    expect(pageQuery("campbell p 12")).toEqual({ pdf: "campbell", page: 12 });
    expect(pageQuery("Campbell p.12")).toEqual({ pdf: "campbell", page: 12 });
    expect(pageQuery("campbell page 7")).toEqual({ pdf: "campbell", page: 7 });
    expect(pageQuery("campbell #3")).toEqual({ pdf: "campbell", page: 3 });
    expect(pageQuery("p 4")).toEqual({ pdf: "", page: 4 });
  });

  it("ignores ordinary searches", () => {
    expect(pageQuery("chapter 12")).toBeNull();
    expect(pageQuery("campbell")).toBeNull();
    expect(pageQuery("campbell p 0")).toBeNull();
  });
});
