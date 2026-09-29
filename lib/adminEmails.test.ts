import { describe, it, expect } from "vitest";
import {
  canAccessEvalOps,
  canAccessEvalProgress,
  canAccessMonthlyReport,
  canAccessQualityEval,
  isAdmin,
  isDomainMember,
} from "./adminEmails";

describe("adminEmails access layers", () => {
  it("평가 진행은 도메인 구성원 전체", () => {
    expect(canAccessEvalProgress("anyone@daangnservice.com")).toBe(true);
    expect(canAccessEvalProgress("Anyone@DaangnService.com")).toBe(true);
    expect(canAccessEvalProgress("a@gmail.com")).toBe(false);
    expect(canAccessEvalProgress("a@evil-daangnservice.com")).toBe(false);
    expect(canAccessEvalProgress(null)).toBe(false);
  });

  it("도메인 구성원이라고 품질평가·월간 리포트가 열리지는 않는다", () => {
    expect(isDomainMember("anyone@daangnservice.com")).toBe(true);
    expect(canAccessQualityEval("anyone@daangnservice.com")).toBe(false);
    expect(canAccessMonthlyReport("anyone@daangnservice.com")).toBe(false);
  });

  it("관리자는 개인 화이트리스트로 품질평가·월간 리포트·평가 진행 모두", () => {
    expect(isAdmin("amir@daangnservice.com")).toBe(true);
    expect(canAccessQualityEval("amir@daangnservice.com")).toBe(true);
    expect(canAccessMonthlyReport("amir@daangnservice.com")).toBe(true);
    expect(canAccessEvalProgress("amir@daangnservice.com")).toBe(true);
  });

  it("eval-ops full list is independent of quality eval", () => {
    expect(canAccessEvalOps("riley.lee@daangnservice.com")).toBe(true);
    expect(canAccessQualityEval("riley.lee@daangnservice.com")).toBe(false);
  });
});
