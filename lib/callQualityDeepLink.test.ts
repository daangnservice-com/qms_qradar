import { describe, it, expect } from "vitest";
import {
  buildCallQualityDeepLink,
  buildCallQualityObserveDeepLink,
  isTruthyQueryParam,
  parseCallQualityDeepLink,
} from "./callQualityDeepLink";

describe("callQualityDeepLink", () => {
  it("defaults observe to false for legacy links", () => {
    const deep = parseCallQualityDeepLink("conversationId=abc-123&autoEval=1");
    expect(deep).toEqual({
      conversationId: "abc-123",
      inquiryId: null,
      autoEval: true,
      observe: false,
      autoStt: false,
    });
  });

  it("parses observe=1 and autoStt=1", () => {
    const deep = parseCallQualityDeepLink("conversationId=abc&observe=1&autoStt=1");
    expect(deep.observe).toBe(true);
    expect(deep.autoStt).toBe(true);
    expect(deep.autoEval).toBe(false);
  });

  it("parses inquiry_id aliases", () => {
    expect(parseCallQualityDeepLink("inquiry_id=123&observe=1").inquiryId).toBe("123");
    expect(parseCallQualityDeepLink("phone_inquiry_id=456&observe=1").inquiryId).toBe("456");
    expect(parseCallQualityDeepLink("phoneInquiryId=789&observe=1").inquiryId).toBe("789");
  });

  it("builds observe deep link with autoStt", () => {
    expect(buildCallQualityObserveDeepLink("cid", { autoStt: true })).toBe(
      "/call-quality?observe=1&conversationId=cid&autoStt=1",
    );
  });

  it("builds observe deep link with inquiry_id only", () => {
    expect(buildCallQualityObserveDeepLink({ inquiryId: "inq-1" }, { autoStt: true })).toBe(
      "/call-quality?observe=1&inquiry_id=inq-1&autoStt=1",
    );
  });

  it("builds eval deep link without observe", () => {
    const url = buildCallQualityDeepLink("cid", { autoEval: true });
    expect(url).toContain("conversationId=cid");
    expect(url).toContain("autoEval=1");
    expect(url).not.toContain("observe");
  });

  it("builds eval deep link with inquiry_id only", () => {
    const url = buildCallQualityDeepLink({ inquiryId: "742375" });
    expect(url).toBe("/call-quality?inquiry_id=742375");
    expect(url).not.toContain("observe");
  });

  it("parses inquiry_id without observe for eval screen", () => {
    const deep = parseCallQualityDeepLink("inquiry_id=742375&autoStt=1");
    expect(deep.inquiryId).toBe("742375");
    expect(deep.observe).toBe(false);
    expect(deep.autoStt).toBe(true);
  });

  it("isTruthyQueryParam", () => {
    expect(isTruthyQueryParam("1")).toBe(true);
    expect(isTruthyQueryParam("true")).toBe(true);
    expect(isTruthyQueryParam("0")).toBe(false);
    expect(isTruthyQueryParam(null)).toBe(false);
  });
});
