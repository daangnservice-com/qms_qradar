import { describe, it, expect } from "vitest";
import { CALL_EVAL_ORG } from "./callQualityOrg";

// 권한 판정은 이 모듈에 없다 — sessionAccess.test.ts 참고.
describe("CALL_EVAL_ORG", () => {
  it("페이팀 폐기 후 콜 평가는 growth 하나", () => {
    expect(CALL_EVAL_ORG).toBe("growth");
  });
});
