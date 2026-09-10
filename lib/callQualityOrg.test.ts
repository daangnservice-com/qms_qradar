import { describe, it, expect } from "vitest";
import { ORG_LABEL, orgFromParam } from "./callQualityOrg";

// 권한 판정은 이 모듈에 없다 — sessionAccess.test.ts / resolveAccess.test.ts 참고.
describe("orgFromParam", () => {
  it("pay만 pay로, 나머지는 growth로 떨어진다", () => {
    expect(orgFromParam("pay")).toBe("pay");
    expect(orgFromParam("growth")).toBe("growth");
    expect(orgFromParam("")).toBe("growth");
    expect(orgFromParam(undefined)).toBe("growth");
    expect(orgFromParam(null)).toBe("growth");
    expect(orgFromParam("PAY")).toBe("growth"); // 대소문자 구분
  });
});

describe("ORG_LABEL", () => {
  it("두 조직 라벨을 모두 가진다", () => {
    expect(ORG_LABEL.growth).toBe("성장문화실");
    expect(ORG_LABEL.pay).toBe("페이팀");
  });
});
