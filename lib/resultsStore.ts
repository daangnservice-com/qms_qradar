import { getBQ } from "./bigquery";
import { growthBq, karrotCsBq } from "./bqRefs";

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

function viewSql(): string {
  const sql = growthBq.qmsCasesDetailSql();
  if (!sql) throw new Error("QMS_CASES_DETAIL_VIEW 가 설정되지 않았습니다");
  return sql;
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
  const v = viewSql();
  const month = filters?.month?.trim() || "";
  const team = filters?.team?.trim() || "";

  const where: string[] = ["1=1"];
  const params: Record<string, string> = {};
  if (month) {
    where.push(`FORMAT_DATE('%Y-%m', year_month) = @month`);
    params.month = month;
  }
  if (team) {
    where.push(
      `COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정') = @team`,
    );
    params.team = team;
  }
  const w = where.join(" AND ");

  const [monthRows, teamRows, memberRows, templateRows] = await Promise.all([
    getBQ().query({
      query: `
        SELECT DISTINCT FORMAT_DATE('%Y-%m', year_month) AS v
        FROM ${v}
        WHERE year_month IS NOT NULL
        ORDER BY v DESC
      `,
      ...loc(),
    }),
    getBQ().query({
      query: `
        SELECT DISTINCT
          COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정') AS v
        FROM ${v}
        WHERE ${w}
        ORDER BY v
      `,
      params,
      ...loc(),
    }),
    getBQ().query({
      query: `
        SELECT DISTINCT
          COALESCE(NULLIF(TRIM(employee_number), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(first_name), ''), '미지정') AS k,
          COALESCE(NULLIF(TRIM(first_name), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(employee_number), ''), '미지정') AS label
        FROM ${v}
        WHERE ${w}
        ORDER BY label
      `,
      params,
      ...loc(),
    }),
    getBQ().query({
      query: `
        SELECT DISTINCT
          COALESCE(CAST(evaluation_template_id AS STRING), NULLIF(TRIM(template_name), ''), '미지정') AS k,
          COALESCE(NULLIF(TRIM(template_name), ''), CAST(evaluation_template_id AS STRING), '미지정') AS label
        FROM ${v}
        WHERE ${w}
        ORDER BY label
      `,
      params,
      ...loc(),
    }),
  ]);

  const months = ((monthRows as unknown[])[0] as { v: string }[]).map((r) => ({
    value: String(r.v),
    label: String(r.v),
  }));
  const teams = ((teamRows as unknown[])[0] as { v: string }[]).map((r) => ({
    value: String(r.v),
    label: String(r.v),
  }));
  const members = ((memberRows as unknown[])[0] as { k: string; label: string }[]).map((r) => ({
    value: String(r.k),
    label: String(r.label),
  }));
  const templates = ((templateRows as unknown[])[0] as { k: string; label: string }[]).map((r) => ({
    value: String(r.k),
    label: String(r.label),
  }));

  return { months, teams, members, templates };
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
  const v = viewSql();
  const where: string[] = [
    `LOWER(IFNULL(status, '')) = 'evaluated'`,
    `LOWER(IFNULL(case_status, '')) = 'evaluated'`,
  ];
  const params: Record<string, string | boolean | number> = { limit: limit + 1 };
  if (month) {
    where.push(`FORMAT_DATE('%Y-%m', year_month) = @month`);
    params.month = month;
  }

  if (filters.team?.trim()) {
    where.push(
      `COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정') = @team`,
    );
    params.team = filters.team.trim();
  }
  if (filters.member?.trim()) {
    where.push(
      `COALESCE(NULLIF(TRIM(employee_number), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(first_name), ''), '미지정') = @member`,
    );
    params.member = filters.member.trim();
  }
  if (filters.template?.trim()) {
    where.push(
      `COALESCE(CAST(evaluation_template_id AS STRING), NULLIF(TRIM(template_name), ''), '미지정') = @template`,
    );
    params.template = filters.template.trim();
  }
  if (filters.wrongOnly) {
    where.push(`NULLIF(TRIM(score_detail), '') IS NOT NULL`);
  }
  if (filters.q?.trim()) {
    where.push(`(
      STRPOS(LOWER(IFNULL(case_content, '')), LOWER(@q)) > 0
      OR STRPOS(LOWER(IFNULL(memo_detail, '')), LOWER(@q)) > 0
      OR STRPOS(LOWER(IFNULL(score_detail, '')), LOWER(@q)) > 0
      OR STRPOS(LOWER(IFNULL(first_name, '')), LOWER(@q)) > 0
      OR STRPOS(CAST(case_id AS STRING), @q) > 0
    )`);
    params.q = filters.q.trim();
  }

  const [rawRows] = await getBQ().query({
    query: `
      SELECT *
      FROM ${v}
      WHERE ${where.join(" AND ")}
      ORDER BY year_month DESC, team_name, first_name, case_id
      LIMIT @limit
    `,
    params,
    types: { limit: "INT64" },
    ...loc(),
  });

  const list = (rawRows as Record<string, unknown>[]).map(mapCaseRow);
  const truncated = list.length > limit;
  return { rows: truncated ? list.slice(0, limit) : list, truncated };
}

export async function getResultsAggregate(filters: {
  month?: string;
  team?: string;
}): Promise<ResultsAggregateResponse> {
  const v = viewSql();
  const where: string[] = ["1=1"];
  const params: Record<string, string> = {};
  if (filters.month?.trim()) {
    where.push(`FORMAT_DATE('%Y-%m', year_month) = @month`);
    params.month = filters.month.trim();
  }
  if (filters.team?.trim()) {
    where.push(
      `COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정') = @team`,
    );
    params.team = filters.team.trim();
  }

  const [rawRows] = await getBQ().query({
    query: `
      SELECT
        FORMAT_DATE('%Y-%m', year_month) AS month_key,
        COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정') AS team_key,
        COALESCE(NULLIF(TRIM(employee_number), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(first_name), ''), '미지정') AS member_key,
        COALESCE(NULLIF(TRIM(first_name), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(employee_number), ''), '미지정') AS member_label,
        COUNT(*) AS case_count,
        COUNTIF(LOWER(TRIM(IFNULL(result, ''))) = 'cold') AS cold_count
      FROM ${v}
      WHERE ${where.join(" AND ")}
        AND year_month IS NOT NULL
        AND LOWER(IFNULL(status, '')) = 'evaluated'
        AND LOWER(IFNULL(case_status, '')) = 'evaluated'
      GROUP BY month_key, team_key, member_key, member_label
      ORDER BY month_key DESC, team_key, member_label
    `,
    params,
    ...loc(),
  });

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

async function seoulYearMonth(): Promise<string> {
  const [rows] = await getBQ().query({
    query: `SELECT FORMAT_DATE('%Y-%m', CURRENT_DATE('Asia/Seoul')) AS ym`,
    ...loc(),
  });
  return String((rows as { ym: string }[])[0]?.ym ?? "");
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

const TEAM_EXPR = `COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정')`;
const TEMPLATE_ID_EXPR = `COALESCE(CAST(evaluation_template_id AS STRING), NULLIF(TRIM(template_name), ''), '미지정')`;
const TEMPLATE_NAME_EXPR = `COALESCE(NULLIF(TRIM(template_name), ''), CAST(evaluation_template_id AS STRING), '미지정')`;
const TARGET_NAME_EXPR = `COALESCE(NULLIF(TRIM(first_name), ''), CAST(target_admin_user_id AS STRING), CAST(evaluation_target_id AS STRING), '미지정')`;

async function unconfirmedFromView(month: string, detail: boolean, openOnly: boolean): Promise<UnconfirmedCurrentMonth> {
  const v = viewSql();
  const [totRes, stRes, leafRes] = await Promise.all([
    getBQ().query({
      query: `
        SELECT
          COUNT(DISTINCT evaluation_id) AS eval_count,
          COUNT(DISTINCT IF(LOWER(IFNULL(evaluation_status, '')) <> 'confirmed', evaluation_id, NULL)) AS open_evals,
          COUNT(DISTINCT evaluation_target_id) AS target_count,
          COUNT(DISTINCT IF(LOWER(IFNULL(status, '')) <> 'evaluated', evaluation_target_id, NULL)) AS open_targets,
          COUNT(DISTINCT case_id) AS case_count,
          COUNT(DISTINCT IF(LOWER(IFNULL(case_status, '')) <> 'evaluated', case_id, NULL)) AS open_cases
        FROM ${v}
        WHERE FORMAT_DATE('%Y-%m', year_month) = @month
      `,
      params: { month },
      ...loc(),
    }),
    getBQ().query({
      query: `
        SELECT evaluation_status AS status, COUNT(DISTINCT evaluation_id) AS n
        FROM ${v}
        WHERE FORMAT_DATE('%Y-%m', year_month) = @month
        GROUP BY 1
        ORDER BY n DESC
      `,
      params: { month },
      ...loc(),
    }),
    detail
      ? getBQ().query({
          query: `
            ${
              openOnly
                ? `WITH open_evals AS (
              SELECT DISTINCT evaluation_id
              FROM ${v}
              WHERE FORMAT_DATE('%Y-%m', year_month) = @month
                AND (
                  LOWER(IFNULL(evaluation_status, '')) <> 'confirmed'
                  OR LOWER(IFNULL(status, '')) <> 'evaluated'
                  OR LOWER(IFNULL(case_status, '')) <> 'evaluated'
                )
            )`
                : ""
            }
            SELECT
              ${TEAM_EXPR} AS team_name,
              ${TEMPLATE_ID_EXPR} AS template_id,
              ANY_VALUE(${TEMPLATE_NAME_EXPR}) AS template_name,
              CAST(evaluation_id AS STRING) AS evaluation_id,
              ANY_VALUE(JSON_VALUE(evaluation_extra, '$.title')) AS evaluation_name,
              ANY_VALUE(evaluation_status) AS eval_status,
              CAST(evaluation_target_id AS STRING) AS target_id,
              ANY_VALUE(${TARGET_NAME_EXPR}) AS target_name,
              ANY_VALUE(status) AS target_status,
              CAST(case_id AS STRING) AS case_id,
              ANY_VALUE(case_status) AS case_status
            FROM ${v}
            WHERE FORMAT_DATE('%Y-%m', year_month) = @month
              ${openOnly ? "AND evaluation_id IN (SELECT evaluation_id FROM open_evals)" : ""}
            GROUP BY 1, 2, 4, 7, 10
            ORDER BY 1, 3, 4, 8, 10
            LIMIT ${UNCONFIRMED_LEAF_LIMIT}
          `,
          params: { month },
          ...loc(),
        })
      : Promise.resolve([[] as UnconfirmedLeaf[]]),
  ]);
  type Totals = {
    eval_count: number;
    open_evals: number;
    target_count: number;
    open_targets: number;
    case_count: number;
    open_cases: number;
  };
  const totRows = (totRes as unknown[])[0] as Totals[];
  const leafRows = ((leafRes as unknown[])[0] as UnconfirmedLeaf[]) || [];
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
    ((stRes as unknown[])[0] as { status: string; n: number }[]) || [],
    leafRows,
    leafRows.length >= UNCONFIRMED_LEAF_LIMIT,
  );
}

async function unconfirmedFromKarrot(month: string, detail: boolean, openOnly: boolean): Promise<UnconfirmedCurrentMonth> {
  const e = karrotCsBq.sql("evaluations");
  const et = karrotCsBq.sql("evaluation_targets");
  const ec = karrotCsBq.sql("evaluation_cases");
  const tem = karrotCsBq.sql("evaluation_templates");

  const [totRes, stRes, leafRes] = await Promise.all([
    getBQ().query({
      query: `
        WITH ev AS (
          SELECT id, status
          FROM ${e}
          WHERE FORMAT_DATE('%Y-%m', year_month) = @month
        )
        SELECT
          (SELECT COUNT(*) FROM ev) AS eval_count,
          (SELECT COUNT(*) FROM ev WHERE LOWER(IFNULL(status, '')) <> 'confirmed') AS open_evals,
          (SELECT COUNT(*) FROM ${et} t JOIN ev ON ev.id = t.evaluation_id) AS target_count,
          (SELECT COUNT(*) FROM ${et} t JOIN ev ON ev.id = t.evaluation_id
            WHERE LOWER(IFNULL(t.status, '')) <> 'evaluated') AS open_targets,
          (SELECT COUNT(*) FROM ${ec} c
            JOIN ${et} t ON t.id = c.evaluation_target_id
            JOIN ev ON ev.id = t.evaluation_id) AS case_count,
          (SELECT COUNT(*) FROM ${ec} c
            JOIN ${et} t ON t.id = c.evaluation_target_id
            JOIN ev ON ev.id = t.evaluation_id
            WHERE LOWER(IFNULL(c.status, '')) <> 'evaluated') AS open_cases
      `,
      params: { month },
      ...loc(),
    }),
    getBQ().query({
      query: `
        SELECT status, COUNT(*) AS n
        FROM ${e}
        WHERE FORMAT_DATE('%Y-%m', year_month) = @month
        GROUP BY 1
        ORDER BY n DESC
      `,
      params: { month },
      ...loc(),
    }),
    detail
      ? getBQ().query({
          query: `
            ${
              openOnly
                ? `WITH open_evals AS (
              SELECT DISTINCT ev.id AS evaluation_id
              FROM ${e} ev
              LEFT JOIN ${et} t ON t.evaluation_id = ev.id
              LEFT JOIN ${ec} c ON c.evaluation_target_id = t.id
              WHERE FORMAT_DATE('%Y-%m', ev.year_month) = @month
                AND (
                  LOWER(IFNULL(ev.status, '')) <> 'confirmed'
                  OR LOWER(IFNULL(t.status, '')) <> 'evaluated'
                  OR LOWER(IFNULL(c.status, '')) <> 'evaluated'
                )
            )`
                : ""
            }
            SELECT
              '미지정' AS team_name,
              CAST(IFNULL(ev.evaluation_template_id, '') AS STRING) AS template_id,
              IFNULL(tem.name, CAST(ev.evaluation_template_id AS STRING)) AS template_name,
              CAST(ev.id AS STRING) AS evaluation_id,
              JSON_VALUE(ev.extra, '$.title') AS evaluation_name,
              ev.status AS eval_status,
              CAST(t.id AS STRING) AS target_id,
              CAST(IFNULL(t.target_admin_user_id, t.id) AS STRING) AS target_name,
              t.status AS target_status,
              CAST(c.id AS STRING) AS case_id,
              c.status AS case_status
            FROM ${e} ev
            LEFT JOIN ${tem} tem ON tem.id = ev.evaluation_template_id
            LEFT JOIN ${et} t ON t.evaluation_id = ev.id
            LEFT JOIN ${ec} c ON c.evaluation_target_id = t.id
            WHERE FORMAT_DATE('%Y-%m', ev.year_month) = @month
              ${openOnly ? "AND ev.id IN (SELECT evaluation_id FROM open_evals)" : ""}
            ORDER BY template_name, evaluation_id, target_id, case_id
            LIMIT ${UNCONFIRMED_LEAF_LIMIT}
          `,
          params: { month },
          ...loc(),
        })
      : Promise.resolve([[] as UnconfirmedLeaf[]]),
  ]);

  const totals = ((totRes as unknown[])[0] as Array<{
    eval_count: number;
    open_evals: number;
    target_count: number;
    open_targets: number;
    case_count: number;
    open_cases: number;
  }>)[0];
  const leafRows = ((leafRes as unknown[])[0] as UnconfirmedLeaf[]) || [];

  return mapUnconfirmedPayload(
    month,
    "karrot",
    totals ?? {
      eval_count: 0,
      open_evals: 0,
      target_count: 0,
      open_targets: 0,
      case_count: 0,
      open_cases: 0,
    },
    ((stRes as unknown[])[0] as { status: string; n: number }[]) || [],
    leafRows,
    leafRows.length >= UNCONFIRMED_LEAF_LIMIT,
  );
}

/** 월별 평가 현황. 뷰 우선, 실패 시 Karrot 원천. */
export async function getUnconfirmedMonth(
  month?: string,
  opts?: { detail?: boolean; openOnly?: boolean },
): Promise<UnconfirmedCurrentMonth> {
  const current = await seoulYearMonth();
  const ym = parseYearMonth(month) || current;
  if (!ym) return emptyUnconfirmed("");
  const detail = opts?.detail !== false;
  const openOnly = opts?.openOnly !== false;

  try {
    return await unconfirmedFromView(ym, detail, openOnly);
  } catch (e) {
    console.warn("[resultsStore] unconfirmed via view failed, falling back to karrot", e);
  }

  try {
    return await unconfirmedFromKarrot(ym, detail, openOnly);
  } catch (e) {
    console.warn("[resultsStore] unconfirmed via karrot failed", e);
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
  try {
    const v = viewSql();
    const [rows] = await getBQ().query({
      query: `
        SELECT DISTINCT FORMAT_DATE('%Y-%m', year_month) AS v
        FROM ${v}
        WHERE year_month IS NOT NULL
        ORDER BY v DESC
      `,
      ...loc(),
    });
    for (const r of (rows as { v: string }[]) || []) {
      const ym = String(r.v || "");
      if (ym) set.add(ym);
    }
  } catch (e) {
    console.warn("[resultsStore] eval status months via view failed", e);
  }
  try {
    const e = karrotCsBq.sql("evaluations");
    const [rows] = await getBQ().query({
      query: `
        SELECT DISTINCT FORMAT_DATE('%Y-%m', year_month) AS v
        FROM ${e}
        WHERE year_month IS NOT NULL
        ORDER BY v DESC
      `,
      ...loc(),
    });
    for (const r of (rows as { v: string }[]) || []) {
      const ym = String(r.v || "");
      if (ym) set.add(ym);
    }
  } catch (e) {
    console.warn("[resultsStore] eval status months via karrot failed", e);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

export async function getEvalStatus(month?: string): Promise<EvalStatusResponse> {
  const current = await seoulYearMonth();
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
  if (!id) return null;
  try {
    const v = viewSql();
    const [rows] = await getBQ().query({
      query: `SELECT * FROM ${v} WHERE CAST(case_id AS STRING) = @caseId LIMIT 1`,
      params: { caseId: id },
      ...loc(),
    });
    const raw = (rows as Record<string, unknown>[])[0];
    if (raw) return mapCaseRow(raw);
  } catch (e) {
    console.warn("[resultsStore] case via view failed", e);
  }
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

  const v = viewSql();

  const [[monthRes], unconfirmed] = await Promise.all([
    getBQ().query({
      query: `
        SELECT DISTINCT FORMAT_DATE('%Y-%m', year_month) AS v
        FROM ${v}
        WHERE year_month IS NOT NULL
        ORDER BY v DESC
      `,
      ...loc(),
    }),
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

  const teamExpr = `COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정')`;
  const memberExpr = `COALESCE(NULLIF(TRIM(employee_number), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(first_name), ''), '미지정')`;
  const sheetExpr = `COALESCE(NULLIF(TRIM(template_name), ''), CAST(evaluation_template_id AS STRING), '미지정')`;
  const caseKindExpr = `LOWER(TRIM(IFNULL(NULLIF(TRIM(case_result), ''), IFNULL(result, ''))))`;

  const [aggRes] = await getBQ().query({
    query: `
      SELECT
        FORMAT_DATE('%Y-%m', year_month) AS month_key,
        ${teamExpr} AS team_label,
        ${sheetExpr} AS template_label,
        ${memberExpr} AS member_key,
        CAST(evaluation_target_id AS STRING) AS evaluation_target_id,
        ANY_VALUE(LOWER(TRIM(IFNULL(result, '')))) AS target_result,
        COUNT(*) AS case_count,
        COUNTIF(${caseKindExpr} = 'hot') AS hot_cases,
        COUNTIF(${caseKindExpr} = 'cold') AS cold_cases,
        COUNTIF(${caseKindExpr} = 'melt') AS melt_cases
      FROM ${v}
      WHERE year_month IS NOT NULL
        AND FORMAT_DATE('%Y-%m', year_month) >= @sqlFrom
        AND FORMAT_DATE('%Y-%m', year_month) <= @sqlTo
        AND LOWER(IFNULL(status, '')) = 'evaluated'
        AND LOWER(IFNULL(case_status, '')) = 'evaluated'
      GROUP BY 1, 2, 3, 4, 5
    `,
    params: { sqlFrom, sqlTo },
    ...loc(),
  });

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
