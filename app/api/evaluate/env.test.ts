import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { numEnv } from "@/lib/env";

const ENV_KEY = "TEST_NUM_ENV_VAR";

describe("numEnv", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("returns the parsed number when the env var is set", () => {
    process.env[ENV_KEY] = "42";
    expect(numEnv(ENV_KEY, 200)).toBe(42);
  });

  it("returns the fallback when the env var is an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(numEnv(ENV_KEY, 200)).toBe(200);
  });

  it("returns the fallback when the env var is unset", () => {
    expect(numEnv(ENV_KEY, 200)).toBe(200);
  });

  it("returns the fallback when the env var is non-numeric", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(numEnv(ENV_KEY, 200)).toBe(200);
  });
});
