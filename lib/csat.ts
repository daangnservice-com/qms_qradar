// 클라이언트 번들에서 import 가능한 CSAT 타입·헬퍼.
// BigQuery 조회는 lib/csatServer.ts — 여기 넣으면 @google-cloud/bigquery → fs 번들 오류.
import { DSAT_DEFAULT_MAX_RATE } from "./highRiskFlags";

export type CsatSentiment = "positive" | "negative" | "";

export interface CsatChoiceMeta {
  label: string;
  sentiment: CsatSentiment;
  issueType: string;
}

/**
 * 선택지 컬럼(choice_*)의 접미 = 사전(utility_inquiry_ratings_choices)의 enum_string.
 * 한글 라벨은 사전에서 읽지만, 사전 조회가 실패해도 화면이 비지 않도록 여기에 폴백을 둔다.
 */
export const CHOICE_FALLBACK: Record<string, CsatChoiceMeta> = {
  correct_answer: { label: "답변이 정확해요", sentiment: "positive", issueType: "" },
  quick_answer: { label: "답변이 빨라요", sentiment: "positive", issueType: "" },
  kindly: { label: "친절해요", sentiment: "positive", issueType: "" },
  positive_etc: { label: "기타", sentiment: "positive", issueType: "" },
  different_answer: { label: "질문 내용과 달라요", sentiment: "negative", issueType: "상담사" },
  cant_understand: { label: "답변이 이해가 안됐어요", sentiment: "negative", issueType: "상담사" },
  unfriendly: { label: "상담 직원이 불친절했어요", sentiment: "negative", issueType: "상담사" },
  late_reply: { label: "상담 연결 또는 답변이 오래 걸렸어요", sentiment: "negative", issueType: "시스템" },
  app_inconvenient: { label: "당근 앱 사용이 불편해요", sentiment: "negative", issueType: "시스템" },
  policy_dissatisfied: { label: "당근 정책이 마음에 들지 않아요", sentiment: "negative", issueType: "정책" },
  negative_etc: { label: "기타", sentiment: "negative", issueType: "기타" },
};

export const CSAT_CHOICE_KEYS = Object.keys(CHOICE_FALLBACK);

export interface CsatChoice {
  /** enum_string (예: unfriendly) */
  key: string;
  /** display_enum — 한글 라벨 */
  label: string;
  sentiment: CsatSentiment;
  /** 사전의 issue_type (상담사 / 시스템 / 정책 / 기타) */
  issueType: string;
}

/** 통화 1건에 매칭된 CSAT 응답. */
export interface CsatRecord {
  csatId: string;
  /** 설문 대상 상담사(원천 admin_user_id). DSAT 도구 딥링크용. */
  adminUserId: string;
  /** 상담이력 ID = inquiry_id */
  phoneInquiryId: string;
  /** 설문 응답 시각(KST) */
  createdAt: string;
  /** 1~5. 설문은 있는데 점수가 비는 경우를 대비해 nullable. */
  rate: number | null;
  comment: string;
  choices: CsatChoice[];
  /** 뷰가 계산해 둔 이슈 유형(쉼표 구분) */
  issueType: string;
  resolved: boolean | null;
  isProfane: boolean;
}

/** DSAT 후속 처리 도구(내부). 1~3점만 해당. 고위험군 플래그 기본값(2점)과 구간이 다르다. */
export const DSAT_TOOL_ORIGIN = "http://172.17.3.56.nip.io:3000";
export const DSAT_TOOL_MAX_RATE = 3;

export function buildDsatToolUrl(csatId: string, adminUserId: string): string | null {
  const id = csatId.trim();
  const admin = adminUserId.trim();
  if (!id || !admin) return null;
  const q = new URLSearchParams({ page: "dsat", csatId: id, adminUserId: admin });
  return `${DSAT_TOOL_ORIGIN}/?${q.toString()}`;
}

export { DSAT_DEFAULT_MAX_RATE };

export function isDsatRate(rate: number | null | undefined, maxRate: number): boolean {
  return typeof rate === "number" && Number.isFinite(rate) && rate <= maxRate;
}
