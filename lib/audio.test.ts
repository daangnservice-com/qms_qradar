import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { saveTempFile, cleanupTempFile } from "./audio";

describe("saveTempFile / cleanupTempFile", () => {
  it("writes bytes to a temp file then removes it", async () => {
    const bytes = new TextEncoder().encode("hello");
    const p = await saveTempFile(bytes, ".m4a");
    expect(existsSync(p)).toBe(true);
    expect(p.endsWith(".m4a")).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("hello");
    await cleanupTempFile(p);
    expect(existsSync(p)).toBe(false);
  });

  it("cleanup does not throw when file is missing", async () => {
    await expect(cleanupTempFile("/tmp/does-not-exist-xyz.m4a")).resolves.toBeUndefined();
  });
});
