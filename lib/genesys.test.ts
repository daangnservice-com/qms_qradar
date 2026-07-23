import { describe, it, expect } from "vitest";
import { extractUrls } from "./genesys";

describe("extractUrls", () => {
  it("picks downloadUri/mediaUri/resultUrl at top level", () => {
    expect(extractUrls({ downloadUri: "a" })).toEqual(["a"]);
    expect(extractUrls({ mediaUri: "b" })).toEqual(["b"]);
    expect(extractUrls({ resultUrl: "c" })).toEqual(["c"]);
  });

  it("walks mediaUris array and object forms", () => {
    expect(extractUrls({ mediaUris: [{ mediaUri: "x" }, { downloadUri: "y" }] })).toEqual(["x", "y"]);
    expect(extractUrls({ mediaUris: { audio: { downloadUri: "z" } } })).toEqual(["z"]);
  });

  it("recurses into nested recording", () => {
    expect(extractUrls({ recording: { downloadUri: "nested" } })).toEqual(["nested"]);
  });

  it("dedupes and ignores non-string/empty", () => {
    expect(extractUrls({ downloadUri: "dup", mediaUris: [{ mediaUri: "dup" }, { mediaUri: "" }] })).toEqual(["dup"]);
    expect(extractUrls(null)).toEqual([]);
    expect(extractUrls("nope")).toEqual([]);
  });
});
