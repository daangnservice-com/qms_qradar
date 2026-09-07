import { describe, expect, it } from "vitest";
import {
  buildCriterionVersionLabel,
  buildImprovedVersionLabel,
  maxVerForDate,
  parseVersionLabel,
  sanitizeVersionNote,
} from "./criterionVersionLabel";

describe("criterionVersionLabel", () => {
  it("sanitizes note", () => {
    expect(sanitizeVersionNote("  foo bar  ")).toBe("foo_bar");
    expect(sanitizeVersionNote("")).toBe("");
  });

  it("parses label", () => {
    expect(parseVersionLabel("260803_ver2_초안")).toEqual({
      yymmdd: "260803",
      ver: 2,
      note: "초안",
    });
    expect(parseVersionLabel("260803_ver1")).toEqual({
      yymmdd: "260803",
      ver: 1,
      note: "",
    });
  });

  it("increments ver N for same day", () => {
    expect(maxVerForDate(["260803_ver1", "260803_ver3_x", "260802_ver9"], "260803")).toBe(3);
  });

  it("builds YYMMDD_verN[_note]", () => {
    const fixed = new Date("2026-08-03T12:00:00+09:00");
    expect(buildCriterionVersionLabel("", [], fixed)).toBe("260803_ver1");
    expect(buildCriterionVersionLabel("초안", ["260803_ver1"], fixed)).toBe("260803_ver2_초안");
    expect(buildCriterionVersionLabel("  a b ", ["260803_ver1", "260803_ver2"], fixed)).toBe("260803_ver3_a_b");
  });

  it("builds base_improved_verN from referenced label", () => {
    expect(buildImprovedVersionLabel("260810_ver2_초안", [])).toBe("260810_ver2_초안_improved_ver1");
    expect(
      buildImprovedVersionLabel("260810_ver2_초안", [
        "260810_ver2_초안_improved_ver1",
        "260810_ver2_초안_improved_ver2",
      ]),
    ).toBe("260810_ver2_초안_improved_ver3");
    expect(buildImprovedVersionLabel("260810_ver2_초안_improved_ver2", ["260810_ver2_초안_improved_ver2"])).toBe(
      "260810_ver2_초안_improved_ver3",
    );
    expect(buildImprovedVersionLabel("", [])).toBe("prompt_improved_ver1");
  });
});
