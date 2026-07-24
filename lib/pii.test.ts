import { describe, it, expect } from "vitest";
import { maskPII } from "./pii";

describe("maskPII", () => {
  it("masks phone numbers keeping last 4", () => {
    expect(maskPII("연락처는 010-1234-5678 입니다")).toBe("연락처는 010-****-5678 입니다");
    expect(maskPII("01098765432")).toBe("010-****-5432");
    expect(maskPII("서울 02-123-4567")).toBe("서울 02-****-4567");
  });

  it("masks resident registration numbers (tail 7)", () => {
    expect(maskPII("901010-1234567")).toBe("901010-*******");
    expect(maskPII("주민 9010101234567 확인")).toBe("주민 901010-******* 확인");
  });

  it("masks card numbers keeping first/last 4", () => {
    expect(maskPII("1234-5678-9012-3456")).toBe("1234-****-****-3456");
    expect(maskPII("1234567890123456")).toBe("1234-****-****-3456");
  });

  it("masks email keeping first char + domain", () => {
    expect(maskPII("karla@daangnservice.com 로 회신")).toBe("k***@daangnservice.com 로 회신");
  });

  it("is idempotent — masked text stays unchanged", () => {
    const once = maskPII("010-1234-5678 / karla@daangn.com / 901010-1234567");
    expect(maskPII(once)).toBe(once);
  });

  it("leaves non-PII text untouched", () => {
    expect(maskPII("환불 처리 부탁드립니다")).toBe("환불 처리 부탁드립니다");
    expect(maskPII("")).toBe("");
  });
});
