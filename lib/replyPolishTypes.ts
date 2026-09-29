/** 문의 채널(당근이) 답변 다듬기 프롬프트 테스트. 클라·서버 공용 타입. */

export const REPLY_POLISH_DEFAULT_TEAM = "중고거래팀";
export const REPLY_POLISH_DEFAULT_TARGET = 100;
export const REPLY_POLISH_MAX_TARGET = 200;
export const REPLY_POLISH_FETCH_MULTIPLIER = 8;
export const REPLY_POLISH_FETCH_CAP = 2000;

export const REPLY_POLISH_VARS = [
  { name: "inquiry", desc: "고객 문의 텍스트" },
  { name: "answer", desc: "당근이 답변 텍스트" },
  { name: "category", desc: "카테고리 이름" },
] as const;

export const DEFAULT_REPLY_POLISH_TEMPLATE = `당신은 당근마켓 고객센터의 문의 답변을 다듬는 편집자입니다.
상담 봇 '당근이'가 작성한 답변의 톤앤매너를 아래 지시에 맞게 다듬으세요.

규칙:
- 사실 관계, 정책, 안내 절차, 링크/숫자/고유명사는 바꾸지 마세요.
- 답변에 없는 약속을 새로 만들지 마세요.
- 최종 결과로 다듬어진 답변 본문만 출력하세요. 설명이나 마크다운 울타리는 넣지 마세요.

카테고리: {{category}}

[문의]
{{inquiry}}

[기존 답변]
{{answer}}
`;

export interface ReplyPolishSample {
  id: string;
  threadId: string;
  category: string;
  team: string;
  createdAt: string;
  inquiry: string;
  answer: string;
  csatRate: number | null;
}

export interface ReplyPolishCategoryCount {
  category: string;
  count: number;
}

export interface ReplyPolishSampleSet {
  id: string;
  team: string;
  dateStart: string;
  dateEnd: string;
  target: number;
  seed: string;
  candidateCount: number;
  csatRates: number[];
  csatIncludeNone: boolean;
  samples: ReplyPolishSample[];
  createdAt: string;
  createdBy: string | null;
}

export type ReplyPolishSampleSetSummary = Omit<ReplyPolishSampleSet, "samples"> & {
  sampleCount: number;
  categories: ReplyPolishCategoryCount[];
};

export interface ReplyPolishTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export type ReplyPolishJobStatus = "pending" | "running" | "done" | "error";
export type ReplyPolishRunStatus = "pending" | "running" | "done" | "error";

export interface ReplyPolishResult {
  id: string;
  runId: string;
  sampleSetId: string;
  sampleId: string;
  templateId: string;
  status: ReplyPolishJobStatus;
  polishedText: string | null;
  error: string | null;
  llmCallId: string | null;
  latencyMs: number | null;
  updatedAt: string;
}

export interface ReplyPolishRun {
  id: string;
  sampleSetId: string;
  templateIds: string[];
  status: ReplyPolishRunStatus;
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}
