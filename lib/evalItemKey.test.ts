import { describe, expect, it } from "vitest";
import {
  itemIdCol,
  mapStoredPurpose,
  phoneIdEqSql,
  phoneIdInSql,
  phoneScopeParams,
  phoneScopeSql,
} from "./evalItemKey";
import { PHONE_SOURCE_SYSTEM, phoneItemRef } from "./evaluationChannel";

describe("evalItemKey purpose mapping", () => {
  it("maps train aliases to qa_eval and everything else to call_eval", () => {
    expect(mapStoredPurpose("qa_eval")).toBe("qa_eval");
    expect(mapStoredPurpose("train")).toBe("qa_eval");
    expect(mapStoredPurpose("call_eval")).toBe("call_eval");
    expect(mapStoredPurpose("text_eval")).toBe("call_eval");
    expect(mapStoredPurpose("ops")).toBe("call_eval");
    expect(mapStoredPurpose(null)).toBe("call_eval");
    expect(mapStoredPurpose("")).toBe("call_eval");
  });
});

describe("evalItemKey phone SQL", () => {
  it("keeps conversation_id predicates on v1", () => {
    expect(itemIdCol(false)).toBe("conversation_id");
    expect(phoneScopeSql(false)).toBe("true");
    expect(phoneIdEqSql(false)).toBe("conversation_id = @cid");
    expect(phoneIdInSql(false)).toBe("conversation_id in unnest(@ids)");
    expect(phoneScopeParams(false)).toEqual({});
  });

  it("scopes v2 queries to genesys phone source_id", () => {
    expect(itemIdCol(true)).toBe("source_id");
    expect(phoneIdEqSql(true)).toBe(
      "channel = @phone_channel and source_system = @phone_source_system and source_id = @cid",
    );
    expect(phoneIdInSql(true, "ids", "r")).toBe(
      "r.channel = @phone_channel and r.source_system = @phone_source_system and r.source_id in unnest(@ids)",
    );
    expect(phoneScopeParams(true)).toEqual({
      phone_channel: "phone",
      phone_source_system: PHONE_SOURCE_SYSTEM,
    });
  });
});

describe("phoneItemRef", () => {
  it("uses genesys + trimmed conversation id", () => {
    expect(phoneItemRef("  abc  ")).toEqual({
      channel: "phone",
      sourceSystem: "genesys",
      sourceId: "abc",
    });
  });
});
