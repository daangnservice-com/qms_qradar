import { describe, expect, it } from "vitest";
import { diffReplyPolishText } from "./replyPolishDiff";

describe("diffReplyPolishText", () => {
  it("marks inserted and deleted characters", () => {
    const parts = diffReplyPolishText("안녕하세요", "안녕하십니까");
    const added = parts.filter((p) => p.added).map((p) => p.value).join("");
    const removed = parts.filter((p) => p.removed).map((p) => p.value).join("");
    expect(added).toContain("십니까");
    expect(removed).toContain("세요");
  });

  it("returns a single unchanged part when texts match", () => {
    expect(diffReplyPolishText("동일", "동일")).toEqual([{ value: "동일" }]);
  });
});
