import { describe, it, expect } from "vitest";
import { normalizeYearMonth } from "./resultsStore";
import { tryParseJson, isHttpUrl, flattenJsonEntries } from "./resultsCaseContent";

describe("resultsStore.normalizeYearMonth", () => {
  it("formats date-like and string values", () => {
    expect(normalizeYearMonth("2026-07-01")).toBe("2026-07");
    expect(normalizeYearMonth("202607")).toBe("2026-07");
    expect(normalizeYearMonth(new Date(Date.UTC(2026, 6, 1)))).toBe("2026-07");
  });
});

describe("resultsCaseContent", () => {
  it("parses json and detects urls", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson("plain")).toBeNull();
    expect(isHttpUrl("https://example.com/x")).toBe(true);
    expect(flattenJsonEntries({ a: { b: "c" } })).toEqual([{ key: "a.b", value: "c" }]);
  });
});
