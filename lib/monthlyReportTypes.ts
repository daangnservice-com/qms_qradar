/** 월간 리포트 공용 타입. 클라이언트 번들에서 값 import 가능 (BQ/fs 없음). */

export type Temp = "H" | "C" | "M";

export type ChannelBucket = {
  H: number;
  C: number;
  M: number;
  items: Record<string, number>;
  memos: string[];
  /** evaluation_target.result 에서 본 온도 (채널 단위가 아니라 대상 단위, 참고용) */
  targetTemp: Temp | null;
};

export type AgentMonth = {
  key: string;
  name: string;
  team: string;
  channels: Record<string, ChannelBucket>;
};

export type TeamMonth = {
  channels: Record<string, ChannelBucket>;
  integrated: { hot: number; cold: number; melt: number };
};

export type MonthAgg = {
  ym: string;
  teams: Record<string, TeamMonth>;
  agents: Record<string, AgentMonth>;
  channels: Record<string, ChannelBucket>;
  items: Record<string, number>;
  /** 케이스 기준 */
  cold: number;
  hot: number;
  melt: number;
  /** 인원 기준. Melt 는 Hot/Cold 와 겹칠 수 있음 */
  integrated: { hot: number; cold: number; melt: number };
};

export type PrimaryCounts = {
  hot: number;
  cold: number;
  melt: number;
  basis: "통합(인원 기준)" | "케이스 기준";
};

export type TeamSplitRow = {
  label: string;
  hot: number;
  cold: number;
  melt: number;
  basis: "인원" | "케이스";
};

export type CriterionLookup = {
  id: number;
  category: string;
  label: string;
};

export type MonthlyCaseRow = {
  month: string;
  team: string;
  memberKey: string;
  memberLabel: string;
  templateName: string;
  caseResult: string;
  targetResult: string;
  scoreDetail: string;
  memoDetail: string;
};

export type TrendPoint = {
  month: string;
  hot: number;
  cold: number;
  melt: number;
  total: number;
  hotRate: number;
  channels: Record<string, { H: number; C: number; M: number }>;
};

export type CategoryTrendPoint = {
  month: string;
  categories: Record<string, number>;
};

export type RepeatColdRow = {
  key: string;
  name: string;
  team: string;
  totalCold: number;
  byMonth: Array<{ month: string; H: number; C: number; M: number }>;
};

export type ItemDrillPerson = {
  name: string;
  team: string;
  channel: string;
  item: string;
  count: number;
};

export type MonthlyReportResponse = {
  month: string;
  team: string;
  allMonths: string[];
  teams: string[];
  selected: MonthAgg | null;
  prev: MonthAgg | null;
  trend: TrendPoint[];
  categoryTrend: CategoryTrendPoint[];
  repeatCold: RepeatColdRow[];
  /** 패턴 분류용 — 채널 H/C/M 만 */
  patternMonths: Array<{
    ym: string;
    agents: Record<string, { name: string; team: string; channels: Record<string, { H: number; C: number; M: number }> }>;
  }>;
};

export type MonthlyReportDraftResponse = {
  month: string;
  team: string;
  specialNotes: string;
  text: string;
  saved: boolean;
  savedAt: string | null;
};
