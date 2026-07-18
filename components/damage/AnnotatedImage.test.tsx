import { describe, it, expect } from "vitest";
import { boxToStyle } from "./AnnotatedImage";

describe("boxToStyle", () => {
  it("converts 0~1000 normalized coords to CSS %", () => {
    expect(boxToStyle({ ymin: 720, xmin: 640, ymax: 880, xmax: 900 })).toEqual({
      left: "64%",
      top: "72%",
      width: "26%",
      height: "16%",
    });
  });

  it("handles a full-frame box", () => {
    expect(boxToStyle({ ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 })).toEqual({
      left: "0%",
      top: "0%",
      width: "100%",
      height: "100%",
    });
  });
});
