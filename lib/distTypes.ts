/** GAS qa_distribution 도메인 타입. 시트·BQ·UI가 같은 모양을 쓴다. */

export type DistChannel = {
  ch: string;
  on: boolean;
  aqt: number;
  jobBe: number;
  csBe: number;
  note: string;
};

export type DistTeam = {
  id: string;
  on: boolean;
  name: string;
  gp: string;
  ppl: number;
  csMode: string;
  difficulty: number;
  cold: number;
  channels: DistChannel[];
};

export type DistGp = {
  name: string;
  /** Slack/Google 이메일 — 평가 스케줄·배분 확정 시 키 */
  email?: string;
  avail: number;
  buffer: number;
  cs: boolean;
  ratio: number;
  locked: boolean;
};

export type DistCfg = {
  days: number;
  avail: number;
  month: string;
};

export type DistJudgeKind = "target" | "excluded" | "unknown";

export type DistRosterPerson = {
  employeeId: string;
  nameEn: string;
  teamName: string;
  part: string;
  level: string;
  employmentType: string;
  status: string;
  hireDate: string;
  convertDate: string;
  exitDate: string;
  autoJudge: string;
  manualJudge: string;
  finalJudge: string;
  judgeKind: DistJudgeKind;
  autoNote: string;
  memo: string;
  evalItems: string[];
  editedBy: string;
  editedAt: string;
};

export type DistAssignUnit = {
  teamName: string;
  ch: string;
  isPhone: boolean;
  ppl: number;
  cs: number;
  job: number;
  aqt: number;
  type: "team" | "channel" | "member";
  kind: "cs" | "job";
  memberId?: string;
  memberName?: string;
  repeat?: boolean;
};

export type DistAssignResult = Record<string, DistAssignUnit[]>;

export type DistAssignMetric = "count" | "time";
export type DistAssignScope = "cs" | "total";

export type DistPlanSnapshot = {
  teams?: DistTeam[] | null;
  gps?: DistGp[] | null;
  aqtBase?: Record<string, number> | null;
  cfg?: DistCfg | null;
};

export type DistHistoryRow = {
  historyId: string;
  evalMonth: string;
  confirmedBy: string;
  confirmedAt: string;
  totalCs: number;
  repeats: number;
  withinPm5: boolean;
  result: DistAssignResult;
  ratios: Array<{ name: string; ratio: number }>;
  metric: DistAssignMetric;
  scope: DistAssignScope;
  planSnapshot: DistPlanSnapshot | null;
};

export type DistColdStat = { rate: number; cold: number; total: number };

export type DistConfirmInfo = { by: string; at: string };

export type DistEvalSet = {
  id: string;
  month: string;
  ver: number;
  label: string;
  confirmed: boolean;
  locked: boolean;
};

export type DistAssignRun = {
  result: DistAssignResult;
  cgps: DistGp[];
  tCS: number;
  month: string;
  runAt: string;
  withinRange: boolean;
  splitTeams: Record<string, boolean>;
  maxSplitTeams: number;
  repeats: number;
  prevMonth: string | null;
  confirmed: boolean;
  metric: DistAssignMetric;
  scope: DistAssignScope;
  manual: boolean;
  pool: number;
  loads: Record<string, number>;
};

export type DistManHourRow = {
  name: string;
  teamLabel: string;
  direct: number;
  csCount: number;
  total: number;
  perDay: number;
  opt: number;
  aqt: number;
  effAqt: number;
  avail: number;
  buffer: number;
  workMin: number;
  lv: { cls: string; label: string };
};
