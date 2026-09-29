// QMS 사람 평가 결과. 화면 조회는 서빙 Postgres(qms_cases, qms_eval_*)만 친다.
// 원천은 BQ 결과 뷰와 Karrot 평가 테이블이고 lib/qmsResultsSync.ts 가 가져온다.
// 당일 평가된 케이스 단건만 스냅샷에 없을 때 BQ Karrot 원천으로 폴백한다.
import { getBQ } from "./bigquery";
import { growthBq, karrotCsBq } from "./bqRefs";
import { servingQuery } from "./servingDb";

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

/** BQ 는 문자열을 코드 포인트 순으로 정렬한다. 같은 순서를 내려고 C collation 을 쓴다. */
const C = `collate "C"`;
const MONTH = `to_char(year_month, 'YYYY-MM')`;
const TEAM_EXPR = `coalesce(nullif(trim(team_name), ''), nullif(trim(fallback_current_team_name), ''), team_id::text, '미지정')`;
const MEMBER_KEY_EXPR = `coalesce(nullif(trim(employee_number), ''), target_admin_user_id::text, nullif(trim(first_name), ''), '미지정')`;
const MEMBER_LABEL_EXPR = `coalesce(nullif(trim(first_name), ''), target_admin_user_id::text, nullif(trim(employee_number), ''), '미지정')`;
const TEMPLATE_KEY_EXPR = `coalesce(evaluation_template_id::text, nullif(trim(template_name), ''), '미지정')`;
const TEMPLATE_LABEL_EXPR = `coalesce(nullif(trim(template_name), ''), evaluation_template_id::text, '미지정')`;
const EVALUATED = `lower(coalesce(status, '')) = 'evaluated' and lower(coalesce(case_status, '')) = 'evaluated'`;

/** pg 는 date 를 로컬 자정 Date 로 준다. 날짜가 밀리지 않게 문자열로 받는다. */
const CASE_COLS = `
  case_id, evaluation_id, evaluation_template_id, evaluation_target_id, template_name,
  year_month::text as year_month, team_id, team_name, target_admin_user_id, first_name,
  status, result, evaluated_count, cold_count, extra, employee_number,
  target_query_started_at::text as target_query_started_at,
  target_query_ended_at::text as target_query_ended_at,
  target_query_per_user_limit, evaluation_extra, evaluation_status, case_content, case_status, case_scores,
  case_result, case_extra, score_detail, memo_detail, fallback_current_team_name
`;

/** 필터 조건을 $n 파라미터로 쌓는다. */
function sqlWhere(initial: string[] = []) {
  const where = [...initial];
  const values: unknown[] = [];
  return {
    where,
    values,
    add(sql: string, value: unknown) {
      values.push(value);
      where.push(sql.replaceAll("?", `$${values.length}`));
    },
    text() {
      return where.length ? where.join(" and ") : "true";
    },
  };
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // BQ DATE often comes as midnight UTC — format as YYYY-MM-DD in UTC
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "object" && v !== null && "value" in (v as object)) {
    return cellStr((v as { value: unknown }).value);
  }
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** DATE/STRING year_month → YYYY-MM */
export function normalizeYearMonth(v: unknown): string {
  const s = cellStr(v);
  if (!s) return "";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  return s;
}

export type ResultsOption = { value: string; label: string };

export type ResultsOptions = {
  months: ResultsOption[];
  teams: ResultsOption[];
  members: ResultsOption[];
  templates: ResultsOption[];
};

export type QmsCaseRow = {
  evaluationId: string;
  evaluationTemplateId: string;
  evaluationTargetId: string;
  templateName: string;
  yearMonth: string;
  teamId: string;
  teamName: string;
  fallbackTeamName: string;
  targetAdminUserId: string;
  firstName: string;
  employeeNumber: string;
  status: string;
  result: string;
  evaluationStatus: string;
  evaluatedCount: number | null;
  coldCount: number | null;
  caseId: string;
  caseContent: string;
  caseStatus: string;
  caseScores: string;
  caseResult: string;
  caseExtra: string;
  scoreDetail: string;
  memoDetail: string;
  evaluationExtra: string;
  extra: string;
  isCold: boolean;
  hasWrongScore: boolean;
  hasMemo: boolean;
  teamLabel: string;
  memberLabel: string;
  memberKey: string;
  templateKey: string;
  templateLabel: string;
  caseKey: string;
};

export type ResultsAggregateMember = {
  memberKey: string;
  memberLabel: string;
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
};

export type ResultsAggregateTeam = {
  teamKey: string;
  teamLabel: string;
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
  members: ResultsAggregateMember[];
};

export type ResultsAggregateMonth = {
  monthKey: string;
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
  teams: ResultsAggregateTeam[];
};

export type ResultsAggregateResponse = {
  months: ResultsAggregateMonth[];
  summary: {
    memberCount: number;
    coldCount: number;
    notColdCount: number;
    coldRate: number;
  };
};

function teamLabelOf(row: {
  team_name?: unknown;
  fallback_current_team_name?: unknown;
  team_id?: unknown;
}): string {
  return (
    cellStr(row.team_name) ||
    cellStr(row.fallback_current_team_name) ||
    cellStr(row.team_id) ||
    "미지정"
  );
}

function memberKeyOf(row: {
  employee_number?: unknown;
  target_admin_user_id?: unknown;
  first_name?: unknown;
}): string {
  return (
    cellStr(row.employee_number) ||
    cellStr(row.target_admin_user_id) ||
    cellStr(row.first_name) ||
    "미지정"
  );
}

function memberLabelOf(row: {
  first_name?: unknown;
  target_admin_user_id?: unknown;
  employee_number?: unknown;
}): string {
  return (
    cellStr(row.first_name) ||
    cellStr(row.target_admin_user_id) ||
    cellStr(row.employee_number) ||
    "미지정"
  );
}

function mapCaseRow(raw: Record<string, unknown>): QmsCaseRow {
  const yearMonth = normalizeYearMonth(raw.year_month);
  const teamLabel = teamLabelOf(raw);
  const templateName = cellStr(raw.template_name);
  const templateId = cellStr(raw.evaluation_template_id);
  const scoreDetail = cellStr(raw.score_detail);
  const memoDetail = cellStr(raw.memo_detail);
  const result = cellStr(raw.result);
  const caseId = cellStr(raw.case_id);
  const evaluationTargetId = cellStr(raw.evaluation_target_id);

  return {
    evaluationId: cellStr(raw.evaluation_id),
    evaluationTemplateId: templateId,
    evaluationTargetId,
    templateName,
    yearMonth,
    teamId: cellStr(raw.team_id),
    teamName: cellStr(raw.team_name),
    fallbackTeamName: cellStr(raw.fallback_current_team_name),
    targetAdminUserId: cellStr(raw.target_admin_user_id),
    firstName: cellStr(raw.first_name),
    employeeNumber: cellStr(raw.employee_number),
    status: cellStr(raw.status),
    result,
    evaluationStatus: cellStr(raw.evaluation_status),
    evaluatedCount: cellNum(raw.evaluated_count),
    coldCount: cellNum(raw.cold_count),
    caseId,
    caseContent: cellStr(raw.case_content),
    caseStatus: cellStr(raw.case_status),
    caseScores: cellStr(raw.case_scores),
    caseResult: cellStr(raw.case_result),
    caseExtra: cellStr(raw.case_extra),
    scoreDetail,
    memoDetail,
    evaluationExtra: cellStr(raw.evaluation_extra),
    extra: cellStr(raw.extra),
    isCold: result.toLowerCase() === "cold",
    hasWrongScore: Boolean(scoreDetail),
    hasMemo: Boolean(memoDetail),
    teamLabel,
    memberLabel: memberLabelOf(raw),
    memberKey: memberKeyOf(raw),
    templateKey: templateId || templateName || "미지정",
    templateLabel: templateName || templateId || "미지정",
    caseKey: caseId || evaluationTargetId || `row_${cellStr(raw.evaluation_id)}`,
  };
}

export async function getResultsOptions(filters?: {
  month?: string;
  team?: string;
}): Promise<ResultsOptions> {
  const month = filters?.month?.trim() || "";
  const team = filters?.team?.trim() || "";
  const w = sqlWhere();
  if (month) w.add(`${MONTH} = ?`, month);
  if (team) w.add(`${TEAM_EXPR} = ?`, team);

  const [monthRows, teamRows, memberRows, templateRows] = await Promise.all([
    servingQuery<{ v: string }>(`
      select distinct ${MONTH} as v from qms_cases where year_month is not null order by v desc
    `),
    servingQuery<{ v: string }>(
      `select distinct (${TEAM_EXPR}) ${C} as v from qms_cases where ${w.text()} order by v`,
      w.values,
    ),
    servingQuery<{ k: string; label: string }>(
      `select distinct ${MEMBER_KEY_EXPR} as k, (${MEMBER_LABEL_EXPR}) ${C} as label from qms_cases where ${w.text()} order by label`,
      w.values,
    ),
    servingQuery<{ k: string; label: string }>(
      `select distinct ${TEMPLATE_KEY_EXPR} as k, (${TEMPLATE_LABEL_EXPR}) ${C} as label from qms_cases where ${w.text()} order by label`,
      w.values,
    ),
  ]);

  return {
    months: monthRows.map((r) => ({ value: String(r.v), label: String(r.v) })),
    teams: teamRows.map((r) => ({ value: String(r.v), label: String(r.v) })),
    members: memberRows.map((r) => ({ value: String(r.k), label: String(r.label) })),
    templates: templateRows.map((r) => ({ value: String(r.k), label: String(r.label) })),
  };
}

export async function listResultsCases(filters: {
  month?: string;
  team?: string;
  member?: string;
  template?: string;
  q?: string;
  wrongOnly?: boolean;
  limit?: number;
}): Promise<{ rows: QmsCaseRow[]; truncated: boolean }> {
  const month = filters.month?.trim() || "";
  const limit = Math.min(Math.max(filters.limit ?? (month ? 800 : 20000), 1), 20000);
  const w = sqlWhere([EVALUATED]);
  if (month) w.add(`${MONTH} = ?`, month);
  if (filters.team?.trim()) w.add(`${TEAM_EXPR} = ?`, filters.team.trim());
  if (filters.member?.trim()) w.add(`${MEMBER_KEY_EXPR} = ?`, filters.member.trim());
  if (filters.template?.trim()) w.add(`${TEMPLATE_KEY_EXPR} = ?`, filters.template.trim());
  if (filters.wrongOnly) w.where.push(`nullif(trim(score_detail), '') is not null`);
  if (filters.q?.trim()) {
    w.add(
      `(
        strpos(lower(coalesce(case_content, '')), lower(?)) > 0
        or strpos(lower(coalesce(memo_detail, '')), lower(?)) > 0
        or strpos(lower(coalesce(score_detail, '')), lower(?)) > 0
        or strpos(lower(coalesce(first_name, '')), lower(?)) > 0
        or strpos(case_id::text, ?) > 0
      )`,
      filters.q.trim(),
    );
  }
  w.values.push(limit + 1);
  const rawRows = await servingQuery<Record<string, unknown>>(
    `
    select ${CASE_COLS}
    from qms_cases
    where ${w.text()}
    order by year_month desc, team_name ${C} nulls first, first_name ${C} nulls first, case_id
    limit $${w.values.length}
    `,
    w.values,
  );

  const list = rawRows.map(mapCaseRow);
  const truncated = list.length > limit;
  return { rows: truncated ? list.slice(0, limit) : list, truncated };
}

export async function getResultsAggregate(filters: {
  month?: string;
  team?: string;
}): Promise<ResultsAggregateResponse> {
  const w = sqlWhere([`year_month is not null`, EVALUATED]);
  if (filters.month?.trim()) w.add(`${MONTH} = ?`, filters.month.trim());
  if (filters.team?.trim()) w.add(`${TEAM_EXPR} = ?`, filters.team.trim());

  const rawRows = await servingQuery(
    `
    select
      ${MONTH} as month_key,
      (${TEAM_EXPR}) ${C} as team_key,
      ${MEMBER_KEY_EXPR} as member_key,
      (${MEMBER_LABEL_EXPR}) ${C} as member_label,
      count(*)::int as case_count,
      (count(*) filter (where lower(trim(coalesce(result, ''))) = 'cold'))::int as cold_count
    from qms_cases
    where ${w.text()}
    group by 1, 2, 3, 4
    order by month_key desc, team_key, member_label
    `,
    w.values,
  );

  type AggRow = {
    month_key: string;
    team_key: string;
    member_key: string;
    member_label: string;
    case_count: number;
    cold_count: number;
  };

  const rows = rawRows as AggRow[];
  const monthMap = new Map<string, ResultsAggregateMonth>();
  const memberKeys = new Set<string>();
  let totalCold = 0;
  let totalNotCold = 0;

  for (const r of rows) {
    const caseCount = Number(r.case_count) || 0;
    const coldCount = Number(r.cold_count) || 0;
    const notCold = caseCount - coldCount;
    totalCold += coldCount;
    totalNotCold += notCold;
    memberKeys.add(String(r.member_key));

    let month = monthMap.get(String(r.month_key));
    if (!month) {
      month = {
        monthKey: String(r.month_key),
        caseCount: 0,
        coldCount: 0,
        notColdCount: 0,
        coldRate: 0,
        teams: [],
      };
      monthMap.set(month.monthKey, month);
    }
    month.caseCount += caseCount;
    month.coldCount += coldCount;
    month.notColdCount += notCold;

    let team = month.teams.find((t) => t.teamKey === String(r.team_key));
    if (!team) {
      team = {
        teamKey: String(r.team_key),
        teamLabel: String(r.team_key),
        caseCount: 0,
        coldCount: 0,
        notColdCount: 0,
        coldRate: 0,
        members: [],
      };
      month.teams.push(team);
    }
    team.caseCount += caseCount;
    team.coldCount += coldCount;
    team.notColdCount += notCold;
    team.members.push({
      memberKey: String(r.member_key),
      memberLabel: String(r.member_label),
      caseCount,
      coldCount,
      notColdCount: notCold,
      coldRate: caseCount ? coldCount / caseCount : 0,
    });
  }

  const months = [...monthMap.values()].map((m) => ({
    ...m,
    coldRate: m.caseCount ? m.coldCount / m.caseCount : 0,
    teams: m.teams.map((t) => ({
      ...t,
      coldRate: t.caseCount ? t.coldCount / t.caseCount : 0,
    })),
  }));

  const caseTotal = totalCold + totalNotCold;
  return {
    months,
    summary: {
      memberCount: memberKeys.size,
      coldCount: totalCold,
      notColdCount: totalNotCold,
      coldRate: caseTotal ? totalCold / caseTotal : 0,
    },
  };
}

export type ResultsReportRange = "3m" | "6m" | "12m" | "all" | "custom";

/** 구성원(evaluation_target) 판정 + 케이스 건수 지표 */
export type ReportRateCell = {
  people: number;
  hotPeople: number;
  coldPeople: number;
  meltPeople: number;
  hotRate: number;
  coldRate: number;
  meltRate: number;
  caseCount: number;
  hotCases: number;
  coldCases: number;
  meltCases: number;
  caseHotRate: number;
  caseColdRate: number;
};

export type ResultsReportInsight = {
  id: string;
  label: string;
  value: string;
  sub: string;
  href: string;
};

export type UnconfirmedCounts = {
  targetCount: number;
  openTargetCount: number;
  caseCount: number;
  openCaseCount: number;
};

export type UnconfirmedCaseNode = {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
};

export type UnconfirmedTargetNode = UnconfirmedCounts & {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  cases: UnconfirmedCaseNode[];
};

export type UnconfirmedSheetNode = UnconfirmedCounts & {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  targets: UnconfirmedTargetNode[];
};

export type UnconfirmedTemplateNode = UnconfirmedCounts & {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  sheetCount: number;
  openSheetCount: number;
  sheets: UnconfirmedSheetNode[];
};

export type UnconfirmedTeamNode = UnconfirmedCounts & {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  sheetCount: number;
  openSheetCount: number;
  templates: UnconfirmedTemplateNode[];
};

export type UnconfirmedCurrentMonth = {
  month: string;
  evalCount: number;
  openEvalCount: number;
  targetCount: number;
  openTargetCount: number;
  caseCount: number;
  openCaseCount: number;
  byEvalStatus: Array<{ status: string; label: string; count: number }>;
  tree: UnconfirmedTeamNode[];
  truncated: boolean;
  source: "view" | "karrot" | "none";
};

export type ResultsReportResponse = {
  range: ResultsReportRange;
  rangeLabel: string;
  monthsInRange: string[];
  allMonths: string[];
  fromMonth: string;
  toMonth: string;
  summary: ReportRateCell & {
    memberCount: number;
    teamCount: number;
    templateCount: number;
    prevHotRate: number | null;
    hotRateDeltaPp: number | null;
  };
  insights: ResultsReportInsight[];
  unconfirmed: UnconfirmedCurrentMonth;
  hotTrend: Array<{ month: string } & ReportRateCell>;
  trendMonths: string[];
  trendMatrix: Array<{
    org: string;
    cells: ReportRateCell[];
  }>;
  teamHotTrend: Array<{
    org: string;
    hotRate: number;
    cells: ReportRateCell[];
  }>;
  byOrg: Array<
    {
      org: string;
      prevHotRate: number | null;
      deltaPp: number | null;
    } & ReportRateCell
  >;
  bySheet: Array<{ name: string } & ReportRateCell>;
  byMonth: Array<{ month: string } & ReportRateCell>;
  /** 선택 기간과 무관하게, 데이터상 가장 최근 월 스냅샷 */
  latestMonth: {
    month: string;
    rates: ReportRateCell;
    hotTeams: string[];
    hotTeamRate: number;
    coldTeams: string[];
    coldTeamRate: number;
    coldSheet: ({ name: string } & ReportRateCell) | null;
  } | null;
};

const REPORT_RANGE_LABEL: Record<Exclude<ResultsReportRange, "custom">, string> = {
  "3m": "최근 3개월",
  "6m": "최근 6개월",
  "12m": "최근 12개월",
  all: "전체 기간",
};

function parseReportRange(raw: string | undefined): ResultsReportRange {
  if (raw === "3m" || raw === "6m" || raw === "12m" || raw === "all" || raw === "custom") return raw;
  return "6m";
}

function parseYearMonth(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

type MemberKind = "hot" | "cold" | "melt";

function emptyRateCell(): ReportRateCell {
  return {
    people: 0,
    hotPeople: 0,
    coldPeople: 0,
    meltPeople: 0,
    hotRate: 0,
    coldRate: 0,
    meltRate: 0,
    caseCount: 0,
    hotCases: 0,
    coldCases: 0,
    meltCases: 0,
    caseHotRate: 0,
    caseColdRate: 0,
  };
}

function rateCellFromCounts(c: {
  hotPeople: number;
  coldPeople: number;
  meltPeople: number;
  caseCount: number;
  hotCases: number;
  coldCases: number;
  meltCases: number;
}): ReportRateCell {
  const people = c.hotPeople + c.coldPeople + c.meltPeople;
  const cases = c.caseCount;
  return {
    people,
    hotPeople: c.hotPeople,
    coldPeople: c.coldPeople,
    meltPeople: c.meltPeople,
    hotRate: people ? c.hotPeople / people : 0,
    coldRate: people ? c.coldPeople / people : 0,
    meltRate: people ? c.meltPeople / people : 0,
    caseCount: cases,
    hotCases: c.hotCases,
    coldCases: c.coldCases,
    meltCases: c.meltCases,
    caseHotRate: cases ? c.hotCases / cases : 0,
    caseColdRate: cases ? c.coldCases / cases : 0,
  };
}

function targetKind(result: string, coldCases: number, meltCases: number): MemberKind {
  const r = result.trim().toLowerCase();
  if (r === "cold") return "cold";
  if (r === "melt") return "melt";
  if (r === "hot") return "hot";
  if (coldCases > 0) return "cold";
  if (meltCases > 0) return "melt";
  return "hot";
}

function mergeKind(a: MemberKind | undefined, b: MemberKind): MemberKind {
  if (a === "cold" || b === "cold") return "cold";
  if (a === "melt" || b === "melt") return "melt";
  return "hot";
}

type PersonBucket = {
  kind: MemberKind;
  caseCount: number;
  hotCases: number;
  coldCases: number;
  meltCases: number;
};

function addPersonToCounts(
  c: {
    hotPeople: number;
    coldPeople: number;
    meltPeople: number;
    caseCount: number;
    hotCases: number;
    coldCases: number;
    meltCases: number;
  },
  p: PersonBucket,
) {
  if (p.kind === "cold") c.coldPeople += 1;
  else if (p.kind === "melt") c.meltPeople += 1;
  else c.hotPeople += 1;
  c.caseCount += p.caseCount;
  c.hotCases += p.hotCases;
  c.coldCases += p.coldCases;
  c.meltCases += p.meltCases;
}

function emptySummary(): ResultsReportResponse["summary"] {
  return {
    ...emptyRateCell(),
    memberCount: 0,
    teamCount: 0,
    templateCount: 0,
    prevHotRate: null,
    hotRateDeltaPp: null,
  };
}

const EVAL_STATUS_LABEL: Record<string, string> = {
  confirmed: "확정",
  gp_review: "GP 검토",
  self_confirm: "본인 확인",
  leader_review: "리더 검토",
  evaluated: "평가완료",
  pending: "대기",
  open: "미확정",
};

const UNCONFIRMED_LEAF_LIMIT = 8000;

function statusLabel(status: string) {
  const key = status.trim().toLowerCase();
  return EVAL_STATUS_LABEL[key] || status || "미지정";
}

function isConfirmedStatus(status: string) {
  return status.trim().toLowerCase() === "confirmed";
}

function isEvaluatedStatus(status: string) {
  return status.trim().toLowerCase() === "evaluated";
}

function parentRollupStatus(open: boolean): { status: string; statusLabel: string } {
  return open
    ? { status: "open", statusLabel: "미확정" }
    : { status: "confirmed", statusLabel: "확정" };
}

type UnconfirmedLeaf = {
  team_name: unknown;
  template_id: unknown;
  template_name: unknown;
  evaluation_id: unknown;
  evaluation_name: unknown;
  eval_status: unknown;
  target_id: unknown;
  target_name: unknown;
  target_status: unknown;
  case_id: unknown;
  case_status: unknown;
};

type AccCase = { id: string; status: string };
type AccTarget = { id: string; name: string; status: string; cases: Map<string, AccCase> };
type AccSheet = { id: string; name: string; status: string; targets: Map<string, AccTarget> };
type AccTemplate = { id: string; name: string; sheets: Map<string, AccSheet> };
type AccTeam = { id: string; name: string; templates: Map<string, AccTemplate> };

function emptyCounts(): UnconfirmedCounts {
  return { targetCount: 0, openTargetCount: 0, caseCount: 0, openCaseCount: 0 };
}

function addCounts(a: UnconfirmedCounts, b: UnconfirmedCounts): UnconfirmedCounts {
  return {
    targetCount: a.targetCount + b.targetCount,
    openTargetCount: a.openTargetCount + b.openTargetCount,
    caseCount: a.caseCount + b.caseCount,
    openCaseCount: a.openCaseCount + b.openCaseCount,
  };
}

function targetCounts(t: AccTarget): UnconfirmedCounts {
  let caseCount = 0;
  let openCaseCount = 0;
  for (const c of t.cases.values()) {
    caseCount += 1;
    if (!isEvaluatedStatus(c.status)) openCaseCount += 1;
  }
  return {
    targetCount: 1,
    openTargetCount: isEvaluatedStatus(t.status) ? 0 : 1,
    caseCount,
    openCaseCount,
  };
}

function sheetCounts(s: AccSheet): UnconfirmedCounts {
  return [...s.targets.values()].reduce((acc, t) => addCounts(acc, targetCounts(t)), emptyCounts());
}

function compareKo(a: string, b: string) {
  return a.localeCompare(b, "ko");
}

function buildUnconfirmedTree(rows: UnconfirmedLeaf[]): UnconfirmedTeamNode[] {
  const teams = new Map<string, AccTeam>();

  for (const row of rows) {
    const evaluationId = String(row.evaluation_id ?? "").trim();
    if (!evaluationId) continue;

    const teamName = String(row.team_name || "").trim() || "미지정";
    const templateId = String(row.template_id || "").trim() || String(row.template_name || "").trim() || "미지정";
    const templateName = String(row.template_name || "").trim() || templateId;
    const evalStatus = String(row.eval_status || "");
    const evalName = String(row.evaluation_name || "").trim();
    const targetId = String(row.target_id ?? "").trim();
    const targetName = String(row.target_name || "").trim() || targetId || "미지정";
    const targetStatus = String(row.target_status || "");
    const caseId = String(row.case_id ?? "").trim();
    const caseStatus = String(row.case_status || "");

    let team = teams.get(teamName);
    if (!team) {
      team = { id: teamName, name: teamName, templates: new Map() };
      teams.set(teamName, team);
    }

    let template = team.templates.get(templateId);
    if (!template) {
      template = { id: templateId, name: templateName, sheets: new Map() };
      team.templates.set(templateId, template);
    } else if (templateName && template.name === templateId) {
      template.name = templateName;
    }

    let sheet = template.sheets.get(evaluationId);
    if (!sheet) {
      sheet = { id: evaluationId, name: evalName, status: evalStatus, targets: new Map() };
      template.sheets.set(evaluationId, sheet);
    } else {
      if (evalStatus) sheet.status = evalStatus;
      if (evalName && !sheet.name) sheet.name = evalName;
    }

    if (!targetId) continue;

    let target = sheet.targets.get(targetId);
    if (!target) {
      target = { id: targetId, name: targetName, status: targetStatus, cases: new Map() };
      sheet.targets.set(targetId, target);
    } else {
      if (targetStatus) target.status = targetStatus;
      if (targetName && target.name === targetId) target.name = targetName;
    }

    if (!caseId) continue;
    target.cases.set(caseId, { id: caseId, status: caseStatus });
  }

  const teamsOut: UnconfirmedTeamNode[] = [];
  for (const team of teams.values()) {
    const templatesOut: UnconfirmedTemplateNode[] = [];
    let teamCounts = emptyCounts();
    let sheetCount = 0;
    let openSheetCount = 0;

    for (const template of team.templates.values()) {
      const sheetsOut: UnconfirmedSheetNode[] = [];
      let templateCounts = emptyCounts();
      let templateSheetCount = 0;
      let templateOpenSheetCount = 0;

      for (const sheet of template.sheets.values()) {
        const counts = sheetCounts(sheet);
        const targetsOut: UnconfirmedTargetNode[] = [...sheet.targets.values()]
          .map((t) => {
            const tc = targetCounts(t);
            const cases = [...t.cases.values()]
              .map((c) => ({
                id: c.id,
                name: c.id,
                status: c.status,
                statusLabel: statusLabel(c.status),
              }))
              .sort((a, b) => {
                const ao = isEvaluatedStatus(a.status) ? 1 : 0;
                const bo = isEvaluatedStatus(b.status) ? 1 : 0;
                return ao - bo || compareKo(a.name, b.name);
              });
            return {
              id: t.id,
              name: t.name,
              status: t.status,
              statusLabel: statusLabel(t.status),
              ...tc,
              cases,
            };
          })
          .sort((a, b) => b.openCaseCount - a.openCaseCount || compareKo(a.name, b.name));

        const sheetOpen =
          !isConfirmedStatus(sheet.status) || counts.openTargetCount > 0 || counts.openCaseCount > 0;
        templateSheetCount += 1;
        if (sheetOpen) templateOpenSheetCount += 1;

        sheetsOut.push({
          id: sheet.id,
          name: sheet.name || `회차 #${sheet.id}`,
          status: sheet.status,
          statusLabel: statusLabel(sheet.status),
          ...counts,
          targets: targetsOut,
        });
        templateCounts = addCounts(templateCounts, counts);
      }

      sheetsOut.sort((a, b) => b.openCaseCount - a.openCaseCount || compareKo(a.name, b.name));
      const templateOpen = templateOpenSheetCount > 0 || templateCounts.openTargetCount > 0 || templateCounts.openCaseCount > 0;
      templatesOut.push({
        id: template.id,
        name: template.name,
        ...parentRollupStatus(templateOpen),
        ...templateCounts,
        sheetCount: templateSheetCount,
        openSheetCount: templateOpenSheetCount,
        sheets: sheetsOut,
      });
      teamCounts = addCounts(teamCounts, templateCounts);
      sheetCount += templateSheetCount;
      openSheetCount += templateOpenSheetCount;
    }

    templatesOut.sort((a, b) => b.openCaseCount - a.openCaseCount || compareKo(a.name, b.name));
    const teamOpen = openSheetCount > 0 || teamCounts.openTargetCount > 0 || teamCounts.openCaseCount > 0;
    teamsOut.push({
      id: team.id,
      name: team.name,
      ...parentRollupStatus(teamOpen),
      ...teamCounts,
      sheetCount,
      openSheetCount,
      templates: templatesOut,
    });
  }

  teamsOut.sort((a, b) => b.openCaseCount - a.openCaseCount || compareKo(a.name, b.name));
  return teamsOut;
}

function emptyUnconfirmed(month: string, source: UnconfirmedCurrentMonth["source"] = "none"): UnconfirmedCurrentMonth {
  return {
    month,
    evalCount: 0,
    openEvalCount: 0,
    targetCount: 0,
    openTargetCount: 0,
    caseCount: 0,
    openCaseCount: 0,
    byEvalStatus: [],
    tree: [],
    truncated: false,
    source,
  };
}

/** 서울 기준 현재 연월 (YYYY-MM). */
export function seoulYearMonth(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

function mapUnconfirmedPayload(
  month: string,
  source: UnconfirmedCurrentMonth["source"],
  totals: {
    eval_count: number;
    open_evals: number;
    target_count: number;
    open_targets: number;
    case_count: number;
    open_cases: number;
  },
  statusRows: Array<{ status: string; n: number }>,
  leafRows: UnconfirmedLeaf[],
  truncated = false,
): UnconfirmedCurrentMonth {
  return {
    month,
    evalCount: Number(totals.eval_count) || 0,
    openEvalCount: Number(totals.open_evals) || 0,
    targetCount: Number(totals.target_count) || 0,
    openTargetCount: Number(totals.open_targets) || 0,
    caseCount: Number(totals.case_count) || 0,
    openCaseCount: Number(totals.open_cases) || 0,
    byEvalStatus: statusRows.map((r) => ({
      status: String(r.status || ""),
      label: statusLabel(String(r.status || "")),
      count: Number(r.n) || 0,
    })),
    tree: buildUnconfirmedTree(leafRows),
    truncated,
    source,
  };
}

/**
 * 월별 평가 진행 현황.
 * 진행 상태는 Karrot 원천 사본(qms_eval_*, 증분 주기마다 갱신)으로, 팀·이름은 결과 뷰 사본(qms_cases, 야간)으로 붙인다.
 * 케이스가 있는 평가만 센다(결과 뷰와 같은 기준 — 월별 건수가 뷰와 같음을 확인했다).
 */
async function unconfirmedFromServing(month: string, detail: boolean, openOnly: boolean): Promise<UnconfirmedCurrentMonth> {
  const joined = `
    qms_eval_cases c
    join qms_eval_targets t on t.id = c.evaluation_target_id
    join qms_eval_evaluations ev on ev.id = t.evaluation_id
  `;
  const inMonth = `to_char(ev.year_month, 'YYYY-MM') = $1`;
  const [totRows, stRows, leafRows] = await Promise.all([
    servingQuery<{
      eval_count: number;
      open_evals: number;
      target_count: number;
      open_targets: number;
      case_count: number;
      open_cases: number;
    }>(
      `
      select
        count(distinct ev.id)::int as eval_count,
        count(distinct ev.id) filter (where lower(coalesce(ev.status, '')) <> 'confirmed')::int as open_evals,
        count(distinct t.id)::int as target_count,
        count(distinct t.id) filter (where lower(coalesce(t.status, '')) <> 'evaluated')::int as open_targets,
        count(distinct c.id)::int as case_count,
        count(distinct c.id) filter (where lower(coalesce(c.status, '')) <> 'evaluated')::int as open_cases
      from ${joined}
      where ${inMonth}
      `,
      [month],
    ),
    servingQuery<{ status: string; n: number }>(
      `
      select ev.status, count(distinct ev.id)::int as n
      from ${joined}
      where ${inMonth}
      group by 1
      order by n desc
      `,
      [month],
    ),
    detail
      ? servingQuery<UnconfirmedLeaf>(
          `
          ${
            openOnly
              ? `with open_evals as (
            select distinct ev.id
            from ${joined}
            where ${inMonth}
              and (
                lower(coalesce(ev.status, '')) <> 'confirmed'
                or lower(coalesce(t.status, '')) <> 'evaluated'
                or lower(coalesce(c.status, '')) <> 'evaluated'
              )
          )`
              : ""
          }
          select
            coalesce(team.label, ev.team_id::text, '미지정') ${C} as team_name,
            coalesce(ev.evaluation_template_id::text, nullif(trim(tem.name), ''), '미지정') as template_id,
            coalesce(nullif(trim(tem.name), ''), ev.evaluation_template_id::text, '미지정') ${C} as template_name,
            ev.id::text ${C} as evaluation_id,
            ev.title as evaluation_name,
            ev.status as eval_status,
            t.id::text as target_id,
            coalesce(person.first_name, t.target_admin_user_id::text, t.id::text, '미지정') ${C} as target_name,
            t.status as target_status,
            c.id::text ${C} as case_id,
            c.status as case_status
          from ${joined}
          left join qms_eval_templates tem on tem.id = ev.evaluation_template_id
          left join lateral (
            select ${TEAM_EXPR} as label from qms_cases q where q.evaluation_id = ev.id limit 1
          ) team on true
          left join lateral (
            select nullif(trim(q.first_name), '') as first_name from qms_cases q
            where q.evaluation_target_id = t.id and nullif(trim(q.first_name), '') is not null
            limit 1
          ) person on true
          where ${inMonth}
            ${openOnly ? "and ev.id in (select id from open_evals)" : ""}
          order by 1, 3, 4, 8, 10
          limit ${UNCONFIRMED_LEAF_LIMIT}
          `,
          [month],
        )
      : Promise.resolve([] as UnconfirmedLeaf[]),
  ]);
  // 건수·트리는 결과 뷰와 같은 기준이라 응답 표기는 그대로 둔다.
  return mapUnconfirmedPayload(
    month,
    "view",
    totRows[0] ?? {
      eval_count: 0,
      open_evals: 0,
      target_count: 0,
      open_targets: 0,
      case_count: 0,
      open_cases: 0,
    },
    stRows,
    leafRows,
    leafRows.length >= UNCONFIRMED_LEAF_LIMIT,
  );
}

/** 월별 평가 현황. */
export async function getUnconfirmedMonth(
  month?: string,
  opts?: { detail?: boolean; openOnly?: boolean },
): Promise<UnconfirmedCurrentMonth> {
  const ym = parseYearMonth(month) || seoulYearMonth();
  const detail = opts?.detail !== false;
  const openOnly = opts?.openOnly !== false;
  try {
    return await unconfirmedFromServing(ym, detail, openOnly);
  } catch (e) {
    console.warn("[resultsStore] unconfirmed failed", e);
    return emptyUnconfirmed(ym);
  }
}

/** 당월 미확정 요약. 리포트 배지용(트리 생략). */
export async function getUnconfirmedCurrentMonth(): Promise<UnconfirmedCurrentMonth> {
  return getUnconfirmedMonth(undefined, { detail: false });
}

export type EvalStatusResponse = UnconfirmedCurrentMonth & { months: string[] };

async function listEvalStatusMonths(current: string): Promise<string[]> {
  const set = new Set<string>();
  if (current) set.add(current);
  const rows = await servingQuery<{ v: string }>(`
    select distinct ${MONTH} as v from qms_cases where year_month is not null
    union
    select distinct to_char(year_month, 'YYYY-MM') from qms_eval_evaluations where year_month is not null
  `);
  for (const r of rows) if (r.v) set.add(r.v);
  return [...set].sort((a, b) => b.localeCompare(a));
}

export async function getEvalStatus(month?: string): Promise<EvalStatusResponse> {
  const current = seoulYearMonth();
  const ym = parseYearMonth(month) || current;
  const [data, months] = await Promise.all([
    getUnconfirmedMonth(ym, { detail: true, openOnly: false }),
    listEvalStatusMonths(current),
  ]);
  const list = months.includes(data.month) || !data.month ? months : [data.month, ...months];
  return { ...data, months: list };
}

export async function getResultsCaseById(caseId: string): Promise<QmsCaseRow | null> {
  const id = caseId.trim();
  if (!/^\d+$/.test(id)) return null;
  try {
    const rows = await servingQuery<Record<string, unknown>>(
      `select ${CASE_COLS} from qms_cases where case_id = $1::bigint`,
      [id],
    );
    if (rows[0]) return mapCaseRow(rows[0]);
  } catch (e) {
    console.warn("[resultsStore] case via serving failed", e);
  }
  // 야간 스냅샷 뒤에 평가된 케이스. 원천을 바로 본다.
  try {
    const e = karrotCsBq.sql("evaluations");
    const et = karrotCsBq.sql("evaluation_targets");
    const ec = karrotCsBq.sql("evaluation_cases");
    const tem = karrotCsBq.sql("evaluation_templates");
    const [rows] = await getBQ().query({
      query: `
        SELECT
          CAST(ev.id AS STRING) AS evaluation_id,
          CAST(ev.evaluation_template_id AS STRING) AS evaluation_template_id,
          CAST(t.id AS STRING) AS evaluation_target_id,
          tem.name AS template_name,
          ev.year_month AS year_month,
          CAST(ev.team_id AS STRING) AS team_id,
          CAST(NULL AS STRING) AS team_name,
          CAST(NULL AS STRING) AS fallback_current_team_name,
          CAST(t.target_admin_user_id AS STRING) AS target_admin_user_id,
          CAST(NULL AS STRING) AS first_name,
          t.status AS status,
          t.result AS result,
          ev.status AS evaluation_status,
          CAST(c.id AS STRING) AS case_id,
          c.content AS case_content,
          c.status AS case_status,
          c.scores AS case_scores,
          c.result AS case_result,
          c.extra AS case_extra,
          ev.extra AS evaluation_extra,
          CAST(NULL AS STRING) AS extra,
          CAST(NULL AS STRING) AS score_detail,
          CAST(NULL AS STRING) AS memo_detail,
          CAST(NULL AS STRING) AS employee_number
        FROM ${ec} c
        LEFT JOIN ${et} t ON t.id = c.evaluation_target_id
        LEFT JOIN ${e} ev ON ev.id = t.evaluation_id
        LEFT JOIN ${tem} tem ON tem.id = ev.evaluation_template_id
        WHERE CAST(c.id AS STRING) = @caseId
        LIMIT 1
      `,
      params: { caseId: id },
      ...loc(),
    });
    const raw = (rows as Record<string, unknown>[])[0];
    return raw ? mapCaseRow(raw) : null;
  } catch (e) {
    console.warn("[resultsStore] case via karrot failed", e);
    return null;
  }
}

/** 품질평가 리포트 — 구성원(evaluation_target) Hot/Cold + 케이스 비율 */
export async function getQualityReport(opts?: {
  range?: string;
  from?: string;
  to?: string;
}): Promise<ResultsReportResponse> {
  let range = parseReportRange(opts?.range);
  let fromYm = parseYearMonth(opts?.from);
  let toYm = parseYearMonth(opts?.to);
  if (fromYm && toYm) {
    if (fromYm > toYm) {
      const tmp = fromYm;
      fromYm = toYm;
      toYm = tmp;
    }
    range = "custom";
  } else if (range === "custom") {
    range = "6m";
    fromYm = null;
    toYm = null;
  }

  const [monthRes, unconfirmed] = await Promise.all([
    servingQuery<{ v: string }>(
      `select distinct ${MONTH} as v from qms_cases where year_month is not null order by v desc`,
    ),
    getUnconfirmedCurrentMonth(),
  ]);
  const allMonthsDesc = ((monthRes as { v: string }[]) || []).map((r) => String(r.v));
  const allMonths = [...allMonthsDesc].sort();
  let monthsInRange: string[];
  if (range === "custom" && fromYm && toYm) {
    monthsInRange = allMonths.filter((m) => m >= fromYm && m <= toYm);
  } else if (range === "all") {
    monthsInRange = [...allMonths];
  } else {
    const take = range === "3m" ? 3 : range === "6m" ? 6 : 12;
    monthsInRange = allMonthsDesc.slice(0, Math.max(take, 0)).slice().sort();
  }
  const fromMonth = monthsInRange[0] ?? fromYm ?? "";
  const toMonth = monthsInRange[monthsInRange.length - 1] ?? toYm ?? "";
  const rangeLabel =
    range === "custom" && fromMonth && toMonth
      ? `${fromMonth} ~ ${toMonth}`
      : range === "custom"
        ? "기간 선택"
        : REPORT_RANGE_LABEL[range];

  const emptyPayload = (): ResultsReportResponse => ({
    range,
    rangeLabel,
    monthsInRange,
    allMonths,
    fromMonth,
    toMonth,
    summary: emptySummary(),
    insights: [],
    unconfirmed,
    hotTrend: [],
    trendMonths: [],
    trendMatrix: [],
    teamHotTrend: [],
    byOrg: [],
    bySheet: [],
    byMonth: [],
    latestMonth: null,
  });

  if (!monthsInRange.length) {
    return emptyPayload();
  }

  const absoluteLatestMonth = allMonthsDesc[0] ?? toMonth;
  const lastMonth = monthsInRange[monthsInRange.length - 1];
  const prevMonthIdx = allMonthsDesc.indexOf(lastMonth) + 1;
  const prevMonthKey =
    prevMonthIdx > 0 && prevMonthIdx < allMonthsDesc.length ? allMonthsDesc[prevMonthIdx] : null;
  const sqlTo = absoluteLatestMonth > toMonth ? absoluteLatestMonth : toMonth;
  const sqlFrom =
    prevMonthKey && prevMonthKey < fromMonth ? prevMonthKey : fromMonth;

  const caseKindExpr = `lower(trim(coalesce(nullif(trim(case_result), ''), coalesce(result, ''))))`;

  const aggRes = await servingQuery(
    `
    select
      ${MONTH} as month_key,
      ${TEAM_EXPR} as team_label,
      ${TEMPLATE_LABEL_EXPR} as template_label,
      ${MEMBER_KEY_EXPR} as member_key,
      evaluation_target_id::text as evaluation_target_id,
      min(lower(trim(coalesce(result, '')))) as target_result,
      count(*)::int as case_count,
      (count(*) filter (where ${caseKindExpr} = 'hot'))::int as hot_cases,
      (count(*) filter (where ${caseKindExpr} = 'cold'))::int as cold_cases,
      (count(*) filter (where ${caseKindExpr} = 'melt'))::int as melt_cases
    from qms_cases
    where year_month is not null
      and ${MONTH} >= $1
      and ${MONTH} <= $2
      and ${EVALUATED}
    group by 1, 2, 3, 4, 5
    order by 1, 2, 3, 4, 5
    `,
    [sqlFrom, sqlTo],
  );

  type AggRow = {
    month_key: string;
    team_label: string;
    template_label: string;
    member_key: string;
    evaluation_target_id: string;
    target_result: string;
    case_count: number;
    hot_cases: number;
    cold_cases: number;
    melt_cases: number;
  };

  type TargetRow = {
    monthKey: string;
    teamLabel: string;
    templateLabel: string;
    memberKey: string;
    targetId: string;
    kind: MemberKind;
    caseCount: number;
    hotCases: number;
    coldCases: number;
    meltCases: number;
  };

  const targets: TargetRow[] = ((aggRes as AggRow[]) || []).map((r) => {
    const coldCases = Number(r.cold_cases) || 0;
    const meltCases = Number(r.melt_cases) || 0;
    return {
      monthKey: String(r.month_key),
      teamLabel: String(r.team_label),
      templateLabel: String(r.template_label),
      memberKey: String(r.member_key),
      targetId: String(r.evaluation_target_id),
      kind: targetKind(String(r.target_result || ""), coldCases, meltCases),
      caseCount: Number(r.case_count) || 0,
      hotCases: Number(r.hot_cases) || 0,
      coldCases,
      meltCases,
    };
  });

  const inRange = (month: string) => month >= fromMonth && month <= toMonth;

  /** month|memberKey → 구성원 월 판정 (같은 달 여러 target은 cold > melt > hot) */
  const personMonth = new Map<string, PersonBucket & { monthKey: string; memberKey: string }>();
  /** month|team|memberKey */
  const orgPersonMonth = new Map<string, PersonBucket & { monthKey: string; teamLabel: string }>();
  /** template|memberKey|month → 평가표별 구성원 월 */
  const sheetPerson = new Map<string, PersonBucket>();

  const members = new Set<string>();
  const teams = new Set<string>();
  const templates = new Set<string>();
  const memberColdMonths = new Map<string, number>();

  for (const t of targets) {
    if (inRange(t.monthKey)) {
      members.add(t.memberKey);
      teams.add(t.teamLabel);
      templates.add(t.templateLabel);
    }

    const pk = `${t.monthKey}\0${t.memberKey}`;
    let person = personMonth.get(pk);
    if (!person) {
      person = {
        monthKey: t.monthKey,
        memberKey: t.memberKey,
        kind: t.kind,
        caseCount: 0,
        hotCases: 0,
        coldCases: 0,
        meltCases: 0,
      };
      personMonth.set(pk, person);
    }
    person.kind = mergeKind(person.kind, t.kind);
    person.caseCount += t.caseCount;
    person.hotCases += t.hotCases;
    person.coldCases += t.coldCases;
    person.meltCases += t.meltCases;

    const ok = `${t.monthKey}\0${t.teamLabel}\0${t.memberKey}`;
    let orgP = orgPersonMonth.get(ok);
    if (!orgP) {
      orgP = {
        monthKey: t.monthKey,
        teamLabel: t.teamLabel,
        kind: t.kind,
        caseCount: 0,
        hotCases: 0,
        coldCases: 0,
        meltCases: 0,
      };
      orgPersonMonth.set(ok, orgP);
    }
    orgP.kind = mergeKind(orgP.kind, t.kind);
    orgP.caseCount += t.caseCount;
    orgP.hotCases += t.hotCases;
    orgP.coldCases += t.coldCases;
    orgP.meltCases += t.meltCases;

    if (inRange(t.monthKey)) {
      const sk = `${t.templateLabel}\0${t.monthKey}\0${t.memberKey}`;
      let sheetP = sheetPerson.get(sk);
      if (!sheetP) {
        sheetP = { kind: t.kind, caseCount: 0, hotCases: 0, coldCases: 0, meltCases: 0 };
        sheetPerson.set(sk, sheetP);
      }
      sheetP.kind = mergeKind(sheetP.kind, t.kind);
      sheetP.caseCount += t.caseCount;
      sheetP.hotCases += t.hotCases;
      sheetP.coldCases += t.coldCases;
      sheetP.meltCases += t.meltCases;
    }
  }

  const monthCounts = new Map<
    string,
    {
      hotPeople: number;
      coldPeople: number;
      meltPeople: number;
      caseCount: number;
      hotCases: number;
      coldCases: number;
      meltCases: number;
    }
  >();
  const rangeCounts = {
    hotPeople: 0,
    coldPeople: 0,
    meltPeople: 0,
    caseCount: 0,
    hotCases: 0,
    coldCases: 0,
    meltCases: 0,
  };

  for (const p of personMonth.values()) {
    let mc = monthCounts.get(p.monthKey);
    if (!mc) {
      mc = { hotPeople: 0, coldPeople: 0, meltPeople: 0, caseCount: 0, hotCases: 0, coldCases: 0, meltCases: 0 };
      monthCounts.set(p.monthKey, mc);
    }
    addPersonToCounts(mc, p);
    if (inRange(p.monthKey)) {
      addPersonToCounts(rangeCounts, p);
      if (p.kind === "cold") {
        memberColdMonths.set(p.memberKey, (memberColdMonths.get(p.memberKey) ?? 0) + 1);
      }
    }
  }

  type OrgMonthCounts = {
    hotPeople: number;
    coldPeople: number;
    meltPeople: number;
    caseCount: number;
    hotCases: number;
    coldCases: number;
    meltCases: number;
  };
  const orgMonthMap = new Map<string, Map<string, OrgMonthCounts>>();
  const orgRange = new Map<string, OrgMonthCounts>();

  function emptyOrgCounts(): OrgMonthCounts {
    return {
      hotPeople: 0,
      coldPeople: 0,
      meltPeople: 0,
      caseCount: 0,
      hotCases: 0,
      coldCases: 0,
      meltCases: 0,
    };
  }

  for (const p of orgPersonMonth.values()) {
    let byMo = orgMonthMap.get(p.teamLabel);
    if (!byMo) {
      byMo = new Map();
      orgMonthMap.set(p.teamLabel, byMo);
    }
    let cell = byMo.get(p.monthKey);
    if (!cell) {
      cell = emptyOrgCounts();
      byMo.set(p.monthKey, cell);
    }
    addPersonToCounts(cell, p);

    if (inRange(p.monthKey)) {
      let org = orgRange.get(p.teamLabel);
      if (!org) {
        org = emptyOrgCounts();
        orgRange.set(p.teamLabel, org);
      }
      addPersonToCounts(org, p);
    }
  }

  const byMonth = monthsInRange.map((month) => {
    const m = monthCounts.get(month) ?? {
      hotPeople: 0,
      coldPeople: 0,
      meltPeople: 0,
      caseCount: 0,
      hotCases: 0,
      coldCases: 0,
      meltCases: 0,
    };
    return { month, ...rateCellFromCounts(m) };
  });
  const hotTrend = byMonth;

  const prevCounts = prevMonthKey ? monthCounts.get(prevMonthKey) : undefined;
  const prevHotRate =
    prevCounts && prevCounts.hotPeople + prevCounts.coldPeople + prevCounts.meltPeople
      ? prevCounts.hotPeople / (prevCounts.hotPeople + prevCounts.coldPeople + prevCounts.meltPeople)
      : null;
  const lastCounts = monthCounts.get(lastMonth);
  const lastPeople = lastCounts
    ? lastCounts.hotPeople + lastCounts.coldPeople + lastCounts.meltPeople
    : 0;
  const lastHotRate = lastPeople && lastCounts ? lastCounts.hotPeople / lastPeople : rateCellFromCounts(rangeCounts).hotRate;
  const hotRateDeltaPp =
    prevHotRate != null ? Math.round((lastHotRate - prevHotRate) * 1000) / 10 : null;

  const orgRateCell = (c: OrgMonthCounts | undefined): ReportRateCell =>
    rateCellFromCounts(
      c ?? {
        hotPeople: 0,
        coldPeople: 0,
        meltPeople: 0,
        caseCount: 0,
        hotCases: 0,
        coldCases: 0,
        meltCases: 0,
      },
    );

  const orgNames = [...orgRange.keys()].sort((a, b) => a.localeCompare(b, "ko"));

  const teamHotTrend = orgNames.map((org) => {
    const cells = monthsInRange.map((mo) => orgRateCell(orgMonthMap.get(org)?.get(mo)));
    const rangeCell = orgRateCell(orgRange.get(org));
    return { org, hotRate: rangeCell.hotRate, cells };
  });

  const trendMonths = monthsInRange.slice(-3);
  const trendMatrix = orgNames.map((org) => ({
    org,
    cells: trendMonths.map((mo) => orgRateCell(orgMonthMap.get(org)?.get(mo))),
  }));

  const byOrg = [...orgRange.entries()]
    .map(([org, d]) => {
      const cell = orgRateCell(d);
      let prevOrgHot: number | null = null;
      if (prevMonthKey) {
        const prev = orgRateCell(orgMonthMap.get(org)?.get(prevMonthKey));
        if (prev.people) prevOrgHot = prev.hotRate;
      }
      const curLast = orgRateCell(orgMonthMap.get(org)?.get(lastMonth));
      const curHot = curLast.people ? curLast.hotRate : cell.hotRate;
      return {
        org,
        ...cell,
        prevHotRate: prevOrgHot,
        deltaPp: prevOrgHot != null ? Math.round((curHot - prevOrgHot) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.hotRate - b.hotRate);

  const sheetCounts = new Map<
    string,
    {
      hotPeople: number;
      coldPeople: number;
      meltPeople: number;
      caseCount: number;
      hotCases: number;
      coldCases: number;
      meltCases: number;
    }
  >();
  for (const [key, p] of sheetPerson) {
    const name = key.split("\0")[0] ?? "미지정";
    let c = sheetCounts.get(name);
    if (!c) {
      c = { hotPeople: 0, coldPeople: 0, meltPeople: 0, caseCount: 0, hotCases: 0, coldCases: 0, meltCases: 0 };
      sheetCounts.set(name, c);
    }
    addPersonToCounts(c, p);
  }
  const bySheet = [...sheetCounts.entries()]
    .map(([name, d]) => ({ name, ...rateCellFromCounts(d) }))
    .sort((a, b) => b.coldRate - a.coldRate);

  // 가장 최근월 스냅샷 (선택 기간과 별도)
  const latestRates = rateCellFromCounts(
    monthCounts.get(absoluteLatestMonth) ?? {
      hotPeople: 0,
      coldPeople: 0,
      meltPeople: 0,
      caseCount: 0,
      hotCases: 0,
      coldCases: 0,
      meltCases: 0,
    },
  );
  const latestTeamCells: Array<{ org: string; cell: ReportRateCell }> = [];
  for (const [org, byMo] of orgMonthMap) {
    const cell = orgRateCell(byMo.get(absoluteLatestMonth));
    if (cell.people > 0) latestTeamCells.push({ org, cell });
  }
  latestTeamCells.sort((a, b) => a.org.localeCompare(b.org, "ko"));
  const maxHotRate = latestTeamCells.reduce((m, t) => Math.max(m, t.cell.hotRate), 0);
  const maxColdRate = latestTeamCells.reduce((m, t) => Math.max(m, t.cell.coldRate), 0);
  const hotTeams =
    maxHotRate > 0
      ? latestTeamCells.filter((t) => Math.abs(t.cell.hotRate - maxHotRate) < 1e-9).map((t) => t.org)
      : [];
  const coldTeams =
    maxColdRate > 0
      ? latestTeamCells.filter((t) => Math.abs(t.cell.coldRate - maxColdRate) < 1e-9).map((t) => t.org)
      : [];

  const latestSheetPeople = new Map<string, Map<string, PersonBucket>>();
  for (const t of targets) {
    if (t.monthKey !== absoluteLatestMonth) continue;
    let byMember = latestSheetPeople.get(t.templateLabel);
    if (!byMember) {
      byMember = new Map();
      latestSheetPeople.set(t.templateLabel, byMember);
    }
    let p = byMember.get(t.memberKey);
    if (!p) {
      p = { kind: t.kind, caseCount: 0, hotCases: 0, coldCases: 0, meltCases: 0 };
      byMember.set(t.memberKey, p);
    }
    p.kind = mergeKind(p.kind, t.kind);
    p.caseCount += t.caseCount;
    p.hotCases += t.hotCases;
    p.coldCases += t.coldCases;
    p.meltCases += t.meltCases;
  }
  const latestSheets = [...latestSheetPeople.entries()]
    .map(([name, byMember]) => {
      const c = {
        hotPeople: 0,
        coldPeople: 0,
        meltPeople: 0,
        caseCount: 0,
        hotCases: 0,
        coldCases: 0,
        meltCases: 0,
      };
      for (const p of byMember.values()) addPersonToCounts(c, p);
      return { name, ...rateCellFromCounts(c) };
    })
    .sort((a, b) => b.coldRate - a.coldRate || b.coldPeople - a.coldPeople);
  const coldSheet = latestSheets[0] ?? null;

  const latestMonth =
    latestRates.people || latestRates.caseCount
      ? {
          month: absoluteLatestMonth,
          rates: latestRates,
          hotTeams,
          hotTeamRate: maxHotRate,
          coldTeams,
          coldTeamRate: maxColdRate,
          coldSheet,
        }
      : null;

  const coachN = [...memberColdMonths.values()].filter((n) => n >= 1).length;
  const coachRepeat = [...memberColdMonths.values()].filter((n) => n >= 2).length;
  const worstOrg = byOrg[0];
  const worstSheet = bySheet[0];
  const summaryRates = rateCellFromCounts(rangeCounts);
  const coldShare = Math.round(summaryRates.coldRate * 1000) / 10;

  const insights: ResultsReportInsight[] = [
    {
      id: "coach",
      label: "Cold 구성원",
      value: `${coachN}명`,
      sub:
        coachRepeat > 0
          ? `기간 내 Cold 판정 구성원 · ${coachRepeat}명은 2개월 이상`
          : "기간 내 한 번이라도 Cold인 구성원이에요",
      href: "/results/aggregate",
    },
    {
      id: "cold-org",
      label: "Hot 낮은 조직",
      value: worstOrg ? worstOrg.org : "—",
      sub: worstOrg
        ? `Hot ${(worstOrg.hotRate * 100).toFixed(1)}% · ${worstOrg.people}명`
        : "집계할 조직이 없어요",
      href: "/results/aggregate",
    },
    {
      id: "cold-sheet",
      label: "Cold율 높은 평가표",
      value: worstSheet ? worstSheet.name : "—",
      sub: worstSheet
        ? `Cold ${(worstSheet.coldRate * 100).toFixed(1)}% · ${worstSheet.people}명`
        : "집계할 평가표가 없어요",
      href: "/results/cases",
    },
    {
      id: "cold-share",
      label: "Cold 구성원 비율",
      value: `${coldShare}%`,
      sub: `콜드 케이스 비율 ${Math.round(summaryRates.caseColdRate * 1000) / 10}%`,
      href: "/results/cases",
    },
  ];

  return {
    range,
    rangeLabel,
    monthsInRange,
    allMonths,
    fromMonth,
    toMonth,
    summary: {
      ...summaryRates,
      memberCount: members.size,
      teamCount: teams.size,
      templateCount: templates.size,
      prevHotRate,
      hotRateDeltaPp,
    },
    insights,
    unconfirmed,
    hotTrend,
    trendMonths,
    trendMatrix,
    teamHotTrend,
    byOrg,
    bySheet,
    byMonth,
    latestMonth,
  };
}
