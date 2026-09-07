import { getBQ } from "./bigquery";
import { distBq } from "./bqRefs";
import type { EvalOpsAccessLevel } from "./adminEmails";
import type {
  DistCfg,
  DistColdStat,
  DistConfirmInfo,
  DistEvalSet,
  DistGp,
  DistHistoryRow,
  DistJudgeKind,
  DistPlanSnapshot,
  DistRosterPerson,
  DistTeam,
} from "./distTypes";
import {
  calendarMonthOf,
  compareDistSetIdDesc,
  distSetLabel,
  evalMonthWhereSql,
  isDistSetId,
  parseDistSetId,
} from "./distSet";
import { parseEvalItems } from "./distWorkload";
import { latestHistoryForMonth } from "./distAssign";

const loc = () => (distBq.location ? { location: distBq.location } : {});

function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && "value" in v) return (v as { value: unknown }).value;
  return v;
}

export function cellStr(v: unknown): string {
  const u = unwrap(v);
  if (u == null) return "";
  if (u instanceof Date && !Number.isNaN(u.getTime())) {
    const y = u.getUTCFullYear();
    const m = String(u.getUTCMonth() + 1).padStart(2, "0");
    const d = String(u.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(u).trim();
}

export function cellYm(v: unknown): string {
  return calendarMonthOf(cellStr(v));
}

/** 배분 셋 ID. `2026-08_ver1` 을 월로 잘라내지 않는다. */
export function cellSetId(v: unknown): string {
  const s = cellStr(v);
  const parsed = parseDistSetId(s);
  if (parsed) return parsed.id;
  return calendarMonthOf(s);
}

export function cellNum(v: unknown): number {
  const n = Number(unwrap(v));
  return Number.isFinite(n) ? n : 0;
}

export function cellBool(v: unknown): boolean {
  const s = cellStr(v).toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes" || s === "예" || s === "on";
}

export function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return "";
}

export function normalizeJudge(raw: string): DistJudgeKind {
  const s = raw.replace(/[✅❌]/g, "").trim();
  if (s === "대상") return "target";
  if (s === "제외") return "excluded";
  return "unknown";
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof Date)) {
    return raw as T;
  }
  const s = cellStr(raw);
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

async function tryQuery<T extends Record<string, unknown>>(query: string, params?: Record<string, unknown>): Promise<T[]> {
  try {
    const [rows] = await getBQ().query({ query, params, ...loc() });
    return ((rows as T[]) || []).filter(Boolean);
  } catch (e) {
    console.warn("[evalOpsStore]", e instanceof Error ? e.message : e);
    return [];
  }
}

export function parseTeams(rows: Record<string, unknown>[]): DistTeam[] {
  const map = new Map<string, DistTeam>();
  const order: string[] = [];
  rows.forEach((r, i) => {
    const id = cellStr(pick(r, "team_id")) || `T${String(i + 1).padStart(2, "0")}`;
    const name = cellStr(pick(r, "team_name"));
    if (!id && !name) return;
    const key = id || name;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        on: cellBool(pick(r, "team_on")) || cellStr(pick(r, "team_on")) === "",
        name,
        gp: cellStr(pick(r, "evaluator_name")),
        ppl: cellNum(pick(r, "headcount")),
        csMode: cellStr(pick(r, "cs_mode")) || "normal",
        difficulty: cellNum(pick(r, "difficulty")) || 1,
        cold: cellNum(pick(r, "cold_pct")),
        channels: [],
      });
      order.push(key);
    }
    const t = map.get(key)!;
    const ch = cellStr(pick(r, "channel_name"));
    if (ch) {
      t.channels.push({
        ch,
        on: cellStr(pick(r, "channel_on")) === "" ? true : cellBool(pick(r, "channel_on")),
        aqt: cellNum(pick(r, "aqt")),
        jobBe: cellNum(pick(r, "job_to_be")),
        csBe: cellNum(pick(r, "cs_to_be")),
        note: cellStr(pick(r, "note")),
      });
    }
  });
  return order.map((k) => map.get(k)!).filter((t) => t.name);
}

export function parseGps(rows: Record<string, unknown>[]): DistGp[] {
  return rows
    .map((r) => ({
      name: cellStr(pick(r, "evaluator_name")),
      email: cellStr(pick(r, "evaluator_email")).toLowerCase() || undefined,
      avail: cellNum(pick(r, "avail_hours")) || 4,
      buffer: cellNum(pick(r, "buffer_pct")),
      cs: cellBool(pick(r, "cs_participate")),
      ratio: cellNum(pick(r, "ratio_pct")),
      locked: cellBool(pick(r, "ratio_locked")),
    }))
    .filter((g) => g.name);
}

export function parseAqtBase(rows: Record<string, unknown>[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const ch = cellStr(pick(r, "channel", "channel_name"));
    if (ch) m[ch] = cellNum(pick(r, "aqt_minutes", "aqt"));
  }
  return m;
}

export function looksLikeEmail(s: string): boolean {
  return s.includes("@");
}

/**
 * 평가대상자_이력 시트 헤더에 `평가항목`이 빠져 마이그레이션이 한 칸 밀린 적재:
 * edited_by 자리에 평가항목(문의,전화…)이 들어 있다. 이메일이면 정상 컬럼.
 */
export function parseSnapshotEvalItems(r: Record<string, unknown>): string[] {
  const direct = parseEvalItems(pick(r, "eval_items"));
  if (direct.length) return direct;
  const shifted = cellStr(pick(r, "edited_by"));
  if (shifted && !looksLikeEmail(shifted)) return parseEvalItems(shifted);
  return [];
}

export function parseConfirmInfo(r: Record<string, unknown>): DistConfirmInfo {
  const a = cellStr(pick(r, "confirmed_by"));
  const b = cellStr(pick(r, "confirmed_at"));
  if (looksLikeEmail(a) && !looksLikeEmail(b)) return { by: a, at: b };
  if (looksLikeEmail(b) && !looksLikeEmail(a)) return { by: b, at: a };
  return { by: a, at: b };
}

/** 명단에 평가항목·수동판정이 비어 있으면 팀 확정 스냅샷 값으로 채운다. */
export function applySnapshotEvalItems(
  roster: DistRosterPerson[],
  snapRows: Record<string, unknown>[],
): DistRosterPerson[] {
  const byId = new Map<string, { items: string[]; manual: string; final: string }>();
  for (const r of snapRows) {
    const id = cellStr(pick(r, "employee_id"));
    if (!id) continue;
    const items = parseSnapshotEvalItems(r);
    const manual = cellStr(pick(r, "manual_judge")).replace(/[✅❌]/g, "").trim();
    const final = cellStr(pick(r, "final_judge"));
    const prev = byId.get(id);
    byId.set(id, {
      items: items.length ? items : prev?.items ?? [],
      manual: manual || prev?.manual || "",
      final: final || prev?.final || "",
    });
  }
  if (!byId.size) return roster;
  return roster.map((p) => {
    const snap = byId.get(p.employeeId);
    if (!snap) return p;
    const evalItems = p.evalItems.length ? p.evalItems : snap.items;
    const manualJudge = p.manualJudge || snap.manual;
    const finalJudge = p.finalJudge || snap.final;
    const judgeKind = normalizeJudge(manualJudge ? (manualJudge === "대상" || manualJudge === "제외" ? manualJudge : finalJudge) : finalJudge);
    return {
      ...p,
      evalItems,
      manualJudge,
      finalJudge,
      judgeKind: judgeKind === "unknown" ? p.judgeKind : judgeKind,
    };
  });
}

export function parseRosterRow(r: Record<string, unknown>): DistRosterPerson {
  const finalJudge = cellStr(pick(r, "final_judge"));
  return {
    employeeId: cellStr(pick(r, "employee_id")),
    nameEn: cellStr(pick(r, "name_en")),
    teamName: cellStr(pick(r, "team_name")),
    part: cellStr(pick(r, "part")),
    level: cellStr(pick(r, "level")),
    employmentType: cellStr(pick(r, "employment_type")),
    status: cellStr(pick(r, "status")),
    hireDate: cellStr(pick(r, "hire_date")).slice(0, 10),
    convertDate: cellStr(pick(r, "convert_date")).slice(0, 10),
    exitDate: cellStr(pick(r, "exit_date")).slice(0, 10),
    autoJudge: cellStr(pick(r, "auto_judge")),
    manualJudge: cellStr(pick(r, "manual_judge")).replace(/[✅❌]/g, "").trim(),
    finalJudge,
    judgeKind: normalizeJudge(finalJudge),
    autoNote: cellStr(pick(r, "auto_note")),
    memo: cellStr(pick(r, "memo")),
    evalItems: parseSnapshotEvalItems(r),
    editedBy: looksLikeEmail(cellStr(pick(r, "edited_by"))) ? cellStr(pick(r, "edited_by")) : "",
    editedAt: cellStr(pick(r, "edited_at")),
  };
}

function parseHistoryRow(r: Record<string, unknown>): DistHistoryRow {
  const meta = parseJson<Record<string, unknown>>(pick(r, "meta_json", "meta"), {});
  const plan: DistPlanSnapshot | null =
    meta.teams || meta.gps
      ? {
          teams: (meta.teams as DistTeam[]) || null,
          gps: (meta.gps as DistGp[]) || null,
          aqtBase: (meta.aqtBase as Record<string, number>) || null,
          cfg: (meta.cfg as DistCfg) || null,
        }
      : null;
  const metric = (cellStr(meta.metric) === "time" ? "time" : "count") as DistHistoryRow["metric"];
  const scope = (cellStr(meta.scope) === "total" ? "total" : "cs") as DistHistoryRow["scope"];
  return {
    historyId: cellStr(pick(r, "history_id")) || cellStr(meta.id),
    evalMonth: cellSetId(pick(r, "eval_month")),
    confirmedBy: cellStr(pick(r, "confirmed_by")),
    confirmedAt: cellStr(pick(r, "confirmed_at")),
    totalCs: cellNum(pick(r, "total_cs")),
    repeats: cellNum(pick(r, "prev_repeats")),
    withinPm5: cellBool(pick(r, "within_pm5")),
    result: parseJson(pick(r, "result_json", "result"), {}),
    ratios: parseJson(pick(r, "ratios_json", "ratios"), []),
    metric,
    scope,
    planSnapshot: plan,
  };
}

export function normalizeColdTeamName(tn: string): string {
  const s = tn.trim();
  if (s.startsWith("페이팀")) return "페이팀";
  return s;
}

export async function readColdData(evalMonth: string): Promise<Record<string, DistColdStat>> {
  const ym = cellYm(evalMonth);
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return {};
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const prev: string[] = [];
  for (let i = 1; i <= 3; i++) {
    let pm = mo - i;
    let py = y;
    if (pm <= 0) {
      pm += 12;
      py--;
    }
    prev.push(`${py}-${String(pm).padStart(2, "0")}`);
  }
  const rows = await tryQuery<Record<string, unknown>>(`SELECT * FROM ${distBq.sql(distBq.tables.teamColdMonthly)}`);
  const teamData: Record<string, { e: number; c: number }> = {};
  for (const r of rows) {
    const rowYm = cellYm(pick(r, "eval_month", "col_0", "ym"));
    const tn = normalizeColdTeamName(cellStr(pick(r, "team_name", "col_1")));
    const ec = cellNum(pick(r, "eval_count", "col_2"));
    const cc = cellNum(pick(r, "cold_count", "col_3"));
    if (!tn || !prev.includes(rowYm)) continue;
    if (!teamData[tn]) teamData[tn] = { e: 0, c: 0 };
    teamData[tn].e += ec;
    teamData[tn].c += cc;
  }
  const res: Record<string, DistColdStat> = {};
  for (const tn of Object.keys(teamData)) {
    const d = teamData[tn];
    res[tn] = {
      rate: d.e > 0 ? Math.round((d.c / d.e) * 1000) / 10 : 0,
      cold: d.c,
      total: d.e,
    };
  }
  return res;
}

export type EvalOpsBootstrap = {
  userLevel: EvalOpsAccessLevel;
  source: "bq" | "empty";
  months: string[];
  month: string;
  locked: boolean;
  lockBy: string;
  lockAt: string;
  copiedFromHint: string;
  latestConfirmedSetId: string;
  sets: DistEvalSet[];
  cfg: DistCfg;
  roster: DistRosterPerson[];
  rosterSummary: {
    total: number;
    target: number;
    excluded: number;
    teamCount: number;
  };
  confirmMap: Record<string, DistConfirmInfo>;
  teams: DistTeam[];
  evaluators: DistGp[];
  aqtBase: Record<string, number>;
  aqt: Array<{ channel: string; minutes: number }>;
  history: DistHistoryRow[];
  coldData: Record<string, DistColdStat>;
  evalItemsOptions: string[];
};

export async function getEvalOpsBootstrap(opts: {
  month?: string;
  userLevel: EvalOpsAccessLevel;
}): Promise<EvalOpsBootstrap> {
  const t = distBq.sql(distBq.tables.evalTargets);
  const [monthRows, teamRows, gpsRows, aqtRows, histRows, cfgRows, optRows, allLockRows] = await Promise.all([
    tryQuery<{ eval_month: unknown }>(`
      SELECT DISTINCT CAST(eval_month AS STRING) AS eval_month
      FROM ${t}
      WHERE eval_month IS NOT NULL AND TRIM(CAST(eval_month AS STRING)) <> ''
      ORDER BY eval_month DESC
    `),
    tryQuery<Record<string, unknown>>(`SELECT * FROM ${distBq.sql(distBq.tables.teams)} LIMIT 800`),
    tryQuery<Record<string, unknown>>(`SELECT * FROM ${distBq.sql(distBq.tables.evaluators)} LIMIT 80`),
    tryQuery<Record<string, unknown>>(`SELECT * FROM ${distBq.sql(distBq.tables.aqt)} LIMIT 80`),
    tryQuery<Record<string, unknown>>(`
      SELECT * FROM ${distBq.sql(distBq.tables.assignHistory)}
      ORDER BY CAST(eval_month AS STRING) ASC
      LIMIT 400
    `),
    tryQuery<Record<string, unknown>>(`SELECT * FROM ${distBq.sql(distBq.tables.config)} LIMIT 40`),
    tryQuery<Record<string, unknown>>(`SELECT * FROM ${distBq.sql(distBq.tables.evalItemOptions)} LIMIT 40`),
    tryQuery<Record<string, unknown>>(`
      SELECT CAST(eval_month AS STRING) AS eval_month
      FROM ${distBq.sql(distBq.tables.monthLocks)}
      LIMIT 200
    `),
  ]);

  const monthIds = Array.from(
    new Set(
      monthRows
        .map((r) => cellSetId(r.eval_month))
        .filter((m) => isDistSetId(m)),
    ),
  ).sort(compareDistSetIdDesc);
  const requested = opts.month?.trim() || "";
  const month =
    (requested && isDistSetId(requested) ? parseDistSetId(requested)!.id : "") || monthIds[0] || "";

  const history = histRows.map(parseHistoryRow).filter((h) => h.evalMonth);
  const confirmedSetIds = new Set(history.map((h) => h.evalMonth).filter(Boolean));

  let roster: DistRosterPerson[] = [];
  let locked = false;
  let lockBy = "";
  let lockAt = "";
  let confirmMap: Record<string, DistConfirmInfo> = {};
  if (month) {
    const [rosterRows, lockRows, snapRows] = await Promise.all([
      tryQuery<Record<string, unknown>>(
        `
          SELECT * FROM ${t}
          WHERE ${evalMonthWhereSql("eval_month")}
          LIMIT 5000
        `,
        { month },
      ),
      tryQuery<Record<string, unknown>>(
        `
          SELECT * FROM ${distBq.sql(distBq.tables.monthLocks)}
          WHERE ${evalMonthWhereSql("eval_month")}
          LIMIT 8
        `,
        { month },
      ),
      tryQuery<Record<string, unknown>>(
        `
          SELECT * FROM ${distBq.sql(distBq.tables.evalTargetSnapshots)}
          WHERE ${evalMonthWhereSql("eval_month")}
          LIMIT 5000
        `,
        { month },
      ),
    ]);
    if (lockRows.length) {
      locked = true;
      lockBy = cellStr(pick(lockRows[0], "confirmed_by"));
      lockAt = cellStr(pick(lockRows[0], "confirmed_at"));
    }
    roster = applySnapshotEvalItems(
      rosterRows.map(parseRosterRow).filter((r) => r.employeeId),
      snapRows,
    );
    for (const r of snapRows) {
      const tn = cellStr(pick(r, "team_name"));
      if (!tn) continue;
      confirmMap[tn] = parseConfirmInfo(r);
    }
  }

  let teams = parseTeams(teamRows);
  let evaluators = parseGps(gpsRows);
  let aqtBase = parseAqtBase(aqtRows);
  const coldCal = calendarMonthOf(month);
  const coldData = coldCal ? await readColdData(coldCal) : {};

  const cfgMap: Record<string, string> = {};
  for (const r of cfgRows) {
    const k = cellStr(pick(r, "key"));
    if (k) cfgMap[k] = cellStr(pick(r, "value"));
  }
  let cfg: DistCfg = {
    days: Number(cfgMap.days) || 15,
    avail: Number(cfgMap.avail) || 4,
    month,
  };

  const confirmedHist = month ? latestHistoryForMonth(history, month) : null;
  if (confirmedHist?.planSnapshot) {
    const snap = confirmedHist.planSnapshot;
    if (snap.teams?.length) teams = snap.teams;
    if (snap.gps?.length) evaluators = snap.gps;
    if (snap.aqtBase && Object.keys(snap.aqtBase).length) aqtBase = snap.aqtBase;
    if (snap.cfg) {
      cfg = {
        days: snap.cfg.days || cfg.days,
        avail: snap.cfg.avail || cfg.avail,
        month,
      };
    }
  }

  const lockedSetIds = new Set(
    allLockRows.map((r) => cellSetId(pick(r, "eval_month"))).filter((id) => isDistSetId(id)),
  );
  if (locked && month) lockedSetIds.add(month);

  const sets: DistEvalSet[] = monthIds.map((id) => {
    const p = parseDistSetId(id)!;
    const confirmed = confirmedSetIds.has(id);
    return {
      id,
      month: p.month,
      ver: p.ver,
      label: distSetLabel(id, confirmed),
      confirmed,
      locked: lockedSetIds.has(id),
    };
  });

  const evalItemsOptions = optRows
    .map((r) => cellStr(pick(r, "item")))
    .filter(Boolean);
  const options = evalItemsOptions.length ? evalItemsOptions : ["문의", "전화", "채팅", "신고", "사업심사", "티켓"];

  const target = roster.filter((r) => r.judgeKind === "target").length;
  const excluded = roster.filter((r) => r.judgeKind === "excluded").length;
  const teamNames = new Set(roster.map((r) => r.teamName).filter(Boolean));
  const latestConfirmed =
    [...history].sort((a, b) => {
      const id = (a.historyId || "").localeCompare(b.historyId || "");
      if (id) return id;
      return (a.confirmedAt || "").localeCompare(b.confirmedAt || "");
    }).at(-1)?.evalMonth ||
    sets.find((s) => s.confirmed)?.id ||
    "";

  return {
    userLevel: opts.userLevel,
    source: monthIds.length || teams.length || evaluators.length ? "bq" : "empty",
    months: monthIds,
    month,
    locked,
    lockBy,
    lockAt,
    copiedFromHint:
      "신규 평가 배분 셋은 선택한 셋의 대상자 유지값(대상 여부·평가항목)·일감·평가자 설정을 복사합니다. 기본값은 가장 최근 확정 셋입니다.",
    latestConfirmedSetId: latestConfirmed,
    sets,
    cfg,
    roster,
    rosterSummary: {
      total: roster.length,
      target,
      excluded,
      teamCount: teamNames.size,
    },
    confirmMap,
    teams,
    evaluators,
    aqtBase,
    aqt: Object.entries(aqtBase).map(([channel, minutes]) => ({ channel, minutes })),
    history,
    coldData,
    evalItemsOptions: options,
  };
}

export function lastConfirmedSnapshot(history: DistHistoryRow[]): {
  month: string;
  snap: DistPlanSnapshot;
  ratios: Array<{ name: string; ratio: number }>;
} | null {
  if (!history.length) return null;
  const last = [...history].sort((a, b) => {
    const c = (a.historyId || "").localeCompare(b.historyId || "");
    if (c) return c;
    return (a.confirmedAt || "").localeCompare(b.confirmedAt || "");
  }).at(-1)!;
  return { month: last.evalMonth, snap: last.planSnapshot || {}, ratios: last.ratios || [] };
}
