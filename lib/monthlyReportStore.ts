import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
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

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

function viewSql(): string {
  const sql = growthBq.qmsCasesDetailSql();
  if (!sql) throw new Error("QMS_CASES_DETAIL_VIEW 가 설정되지 않았습니다");
  return sql;
}

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

const TEAM_EXPR = `COALESCE(NULLIF(TRIM(team_name), ''), NULLIF(TRIM(fallback_current_team_name), ''), CAST(team_id AS STRING), '미지정')`;
const MEMBER_KEY_EXPR = `COALESCE(NULLIF(TRIM(employee_number), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(first_name), ''), '미지정')`;
const MEMBER_LABEL_EXPR = `COALESCE(NULLIF(TRIM(first_name), ''), CAST(target_admin_user_id AS STRING), NULLIF(TRIM(employee_number), ''), '미지정')`;

async function listMonths(): Promise<string[]> {
  const v = viewSql();
  const [rows] = await getBQ().query({
    query: `
      SELECT DISTINCT FORMAT_DATE('%Y-%m', year_month) AS v
      FROM ${v}
      WHERE year_month IS NOT NULL
      ORDER BY v
    `,
    ...loc(),
  });
  return ((rows as { v: string }[]) || []).map((r) => String(r.v)).filter(Boolean);
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
  const v = viewSql();
  const [rows] = await getBQ().query({
    query: `
      SELECT
        FORMAT_DATE('%Y-%m', year_month) AS month_key,
        ${TEAM_EXPR} AS team_label,
        ${MEMBER_KEY_EXPR} AS member_key,
        ${MEMBER_LABEL_EXPR} AS member_label,
        COALESCE(NULLIF(TRIM(template_name), ''), CAST(evaluation_template_id AS STRING), '미지정') AS template_name,
        LOWER(TRIM(IFNULL(NULLIF(TRIM(case_result), ''), IFNULL(result, '')))) AS case_result,
        LOWER(TRIM(IFNULL(result, ''))) AS target_result,
        score_detail,
        memo_detail
      FROM ${v}
      WHERE year_month IS NOT NULL
        AND LOWER(IFNULL(status, '')) = 'evaluated'
        AND LOWER(IFNULL(case_status, '')) = 'evaluated'
    `,
    ...loc(),
  });
  return ((rows as Record<string, unknown>[]) || []).map(mapCaseRow);
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
