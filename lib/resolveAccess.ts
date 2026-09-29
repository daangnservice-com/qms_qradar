import {
  MONTHLY_REPORT_GROUP_EMAILS,
  QUALITY_EVAL_GROUP_EMAILS,
  canAccessMonthlyReport,
  canAccessQualityEval,
} from "./adminEmails";
import { isMemberOfAnyGroup } from "./googleGroups";

// 평가 진행은 도메인 기준(canAccessEvalProgress)이라 Groups 조회가 필요 없다.

/** 평가 설계·품질평가(리포트). */
export async function resolveCanAccessQualityEval(
  email: string | null | undefined,
): Promise<boolean> {
  if (canAccessQualityEval(email)) return true;
  if (QUALITY_EVAL_GROUP_EMAILS.length === 0) return false;
  return isMemberOfAnyGroup(email, QUALITY_EVAL_GROUP_EMAILS);
}

/** 품질평가 > 월간 리포트. quality eval 권한이면 포함. */
export async function resolveCanAccessMonthlyReport(
  email: string | null | undefined,
): Promise<boolean> {
  if (canAccessMonthlyReport(email)) return true;
  if (await resolveCanAccessQualityEval(email)) return true;
  if (MONTHLY_REPORT_GROUP_EMAILS.length === 0) return false;
  return isMemberOfAnyGroup(email, MONTHLY_REPORT_GROUP_EMAILS);
}
