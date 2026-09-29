// 월간 품질 리포트. 케이스는 서빙 Postgres(qms_cases, 야간 갱신)에서 읽는다.
import { servingQuery } from "./servingDb";
import { loadCsChecklist } from "./csChecklistLoad";
import {
  buildMonthsFromCases,
  buildRepeatCold,
  buildTrend,
  categoryTotals,
  patternMonthsOf,
  scopeMonthToTeam,
} from "./monthlyReportLogic";
import type {
  CategoryTrendPoint,
  CriterionLookup,
  MonthAgg,
  MonthlyCaseRow,
  MonthlyReportResponse,
} from "./monthlyReportTypes";

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
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

function parseYearMonth(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

const TEAM_EXPR = `coalesce(nullif(trim(team_name), ''), nullif(trim(fallback_current_team_name), ''), team_id::text, '미지정')`;
const MEMBER_KEY_EXPR = `coalesce(nullif(trim(employee_number), ''), target_admin_user_id::text, nullif(trim(first_name), ''), '미지정')`;
const MEMBER_LABEL_EXPR = `coalesce(nullif(trim(first_name), ''), target_admin_user_id::text, nullif(trim(employee_number), ''), '미지정')`;

async function listMonths(): Promise<string[]> {
  const rows = await servingQuery<{ v: string }>(`
    select distinct to_char(year_month, 'YYYY-MM') as v
    from qms_cases
    where year_month is not null
    order by v
  `);
  return rows.map((r) => String(r.v)).filter(Boolean);
}

function mapCaseRow(raw: Record<string, unknown>): MonthlyCaseRow {
  return {
    month: cellStr(raw.month_key) || cellStr(raw.year_month).slice(0, 7),
    team: cellStr(raw.team_label) || "미지정",
    memberKey: cellStr(raw.member_key) || "미지정",
    memberLabel: cellStr(raw.member_label) || cellStr(raw.member_key) || "미지정",
    templateName: cellStr(raw.template_name),
    caseResult: cellStr(raw.case_result) || cellStr(raw.result),
    targetResult: cellStr(raw.target_result) || cellStr(raw.result),
    scoreDetail: cellStr(raw.score_detail),
    memoDetail: cellStr(raw.memo_detail),
  };
}

async function loadCases(): Promise<MonthlyCaseRow[]> {
  const rows = await servingQuery<Record<string, unknown>>(`
    select
      to_char(year_month, 'YYYY-MM') as month_key,
      ${TEAM_EXPR} as team_label,
      ${MEMBER_KEY_EXPR} as member_key,
      ${MEMBER_LABEL_EXPR} as member_label,
      coalesce(nullif(trim(template_name), ''), evaluation_template_id::text, '미지정') as template_name,
      lower(trim(coalesce(nullif(trim(case_result), ''), coalesce(result, '')))) as case_result,
      lower(trim(coalesce(result, ''))) as target_result,
      score_detail,
      memo_detail
    from qms_cases
    where year_month is not null
      and lower(coalesce(status, '')) = 'evaluated'
      and lower(coalesce(case_status, '')) = 'evaluated'
    order by year_month, case_id
  `);
  // 채널별 대상 판정은 마지막 행이 이긴다. 순서를 고정해 새로고침마다 바뀌지 않게 한다.
  return rows.map(mapCaseRow);
}

function monthsAsc(byYm: Record<string, MonthAgg>): MonthAgg[] {
  return Object.keys(byYm)
    .sort()
    .map((ym) => byYm[ym]);
}

function categoryTrendOf(months: MonthAgg[], criteria: CriterionLookup[]): CategoryTrendPoint[] {
  const criteriaById = new Map(criteria.map((c) => [c.id, c]));
  return months.map((m) => ({
    month: m.ym,
    categories: categoryTotals(m.items, criteriaById),
  }));
}

export async function getMonthlyQualityReport(opts?: {
  month?: string;
  team?: string;
}): Promise<MonthlyReportResponse> {
  const team = (opts?.team ?? "").trim();
  const teamFilter = team && team !== "__all__" ? team : "";

  const [allMonths, cases, checklist] = await Promise.all([
    listMonths(),
    loadCases(),
    loadCsChecklist(),
  ]);
  const criteria: CriterionLookup[] = checklist.map((c) => ({
    id: c.id,
    category: c.category,
    label: c.label,
  }));

  const byYm = buildMonthsFromCases(cases, criteria);
  const monthKeys = Object.keys(byYm).sort();
  const months = monthKeys.length ? monthKeys : allMonths;
  const requested = parseYearMonth(opts?.month) || months[months.length - 1] || "";
  const selectedYm = months.includes(requested) ? requested : months[months.length - 1] || "";
  const idx = months.indexOf(selectedYm);
  const prevYm = idx > 0 ? months[idx - 1] : null;

  const rawSelected = selectedYm ? byYm[selectedYm] ?? null : null;
  const rawPrev = prevYm ? byYm[prevYm] ?? null : null;
  const selected = scopeMonthToTeam(rawSelected, teamFilter || "__all__");
  const prev = scopeMonthToTeam(rawPrev, teamFilter || "__all__");

  const scopedAll = monthsAsc(byYm)
    .map((m) => scopeMonthToTeam(m, teamFilter || "__all__"))
    .filter((m): m is MonthAgg => Boolean(m));

  const teams = rawSelected ? Object.keys(rawSelected.teams).sort((a, b) => a.localeCompare(b, "ko")) : [];

  return {
    month: selectedYm,
    team: teamFilter,
    allMonths: months,
    teams,
    selected,
    prev,
    trend: buildTrend(scopedAll),
    categoryTrend: categoryTrendOf(scopedAll, criteria),
    repeatCold: buildRepeatCold(scopedAll),
    patternMonths: patternMonthsOf(scopedAll),
  };
}
