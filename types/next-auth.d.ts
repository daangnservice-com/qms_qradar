import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    access?: {
      /** 평가 설계·품질평가(리포트) */
      qualityEval: boolean;
      /** 품질평가 > 월간 리포트 (L5 리더 + qualityEval) */
      monthlyReport: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    qualityEvalAccess?: boolean;
    monthlyReportAccess?: boolean;
    /** 구 JWT 잔여 — 평가 진행이 도메인 기준이 되며 폐기. 다음 갱신 때 지운다. */
    evalProgressAllAccess?: boolean;
    callQualityAccess?: boolean;
    accessCheckedAt?: number;
  }
}
