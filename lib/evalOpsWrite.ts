import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBQ } from "./bigquery";
import { distBq } from "./bqRefs";
import {
  applySnapshotEvalItems,
  cellStr,
  lastConfirmedSnapshot,
  parseRosterRow,
  type EvalOpsBootstrap,
} from "./evalOpsStore";
import { calendarMonthOf, evalMonthWhereSql, isDistSetId, nextDistSetId, parseDistSetId } from "./distSet";
import { latestHistoryForMonth } from "./distAssign";
import { finalJudge, isExcludedTeam, judgeTarget } from "./evalTargetJudge";
import type { DistCfg, DistGp, DistAssignRun, DistRosterPerson, DistTeam } from "./distTypes";

const loc = () => (distBq.location ? { location: distBq.location } : {});

function tableRef(name: string) {
  return getBQ().dataset(distBq.dataset, { projectId: distBq.projectId }).table(name);
}

async function tableCols(tableName: string): Promise<Set<string>> {
  const [meta] = await tableRef(tableName).getMetadata();
  return new Set(((meta.schema?.fields ?? []) as Array<{ name: string }>).map((f) => f.name));
}

async function ensureEvalItemsColumn(): Promise<void> {
  const cols = await tableCols(distBq.tables.evalTargets);
  if (cols.has("eval_items")) return;
  await getBQ().query({
    query: `ALTER TABLE ${distBq.sql(distBq.tables.evalTargets)} ADD COLUMN IF NOT EXISTS eval_items STRING`,
    ...loc(),
  });
}

async function ensureEvaluatorEmailColumns(): Promise<void> {
  const alters: string[] = [];
  const evalCols = await tableCols(distBq.tables.evaluators);
  if (!evalCols.has("evaluator_email")) {
    alters.push(
      `ALTER TABLE ${distBq.sql(distBq.tables.evaluators)} ADD COLUMN IF NOT EXISTS evaluator_email STRING`,
    );
  }
  const detailCols = await tableCols(distBq.tables.assignDetail);
  for (const col of ["evaluator_email", "history_id", "member_id", "member_name"] as const) {
    if (!detailCols.has(col)) {
      alters.push(
        `ALTER TABLE ${distBq.sql(distBq.tables.assignDetail)} ADD COLUMN IF NOT EXISTS ${col} STRING`,
      );
    }
  }
  for (const q of alters) await getBQ().query({ query: q, ...loc() });
}

function fitRow(row: Record<string, string>, cols: Set<string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of Object.keys(row)) if (cols.has(k)) o[k] = row[k] ?? "";
  if (cols.has("_ingested_at") && !o._ingested_at) o._ingested_at = new Date().toISOString();
  if (cols.has("_source_sheet") && !o._source_sheet) o._source_sheet = "qradar";
  return o;
}

async function loadNdjson(
  tableName: string,
  rows: Record<string, string>[],
  writeDisposition: "WRITE_TRUNCATE" | "WRITE_APPEND",
): Promise<void> {
  const table = tableRef(tableName);
  const [meta] = await table.getMetadata();
  const fields = [...((meta.schema?.fields ?? []) as Array<{ name: string; type: string }>)];
  if (rows.some((r) => r.eval_items != null) && !fields.some((f) => f.name === "eval_items")) {
    fields.push({ name: "eval_items", type: "STRING" });
  }
  const ingestedAt = new Date().toISOString();
  const normalized = rows.map((r) => {
    const o: Record<string, string> = {};
    for (const f of fields) {
      if (f.name === "_ingested_at") o[f.name] = ingestedAt;
      else if (f.name === "_source_sheet") o[f.name] = r._source_sheet ?? "qradar";
      else o[f.name] = r[f.name] ?? "";
    }
    return o;
  });
  const tmpDir = mkdtempSync(join(tmpdir(), "evalops-"));
  const ndjsonPath = join(tmpDir, `${tableName}.ndjson`);
  try {
    writeFileSync(
      ndjsonPath,
      normalized.length ? normalized.map((r) => JSON.stringify(r)).join("\n") + "\n" : "",
      "utf8",
    );
    const [job] = await table.load(ndjsonPath, {
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      writeDisposition,
      autodetect: false,
      schema: { fields },
      location: distBq.location || undefined,
    });
    const jobAny = job as { promise?: () => Promise<unknown> };
    if (typeof jobAny.promise === "function") await jobAny.promise.call(job);
  } finally {
    try {
      unlinkSync(ndjsonPath);
    } catch {
      /* ignore */
    }
  }
}

async function insertFitted(tableName: string, rows: Record<string, string>[]): Promise<void> {
  if (!rows.length) return;
  const cols = await tableCols(tableName);
  await loadNdjson(tableName, rows.map((r) => fitRow(r, cols)), "WRITE_APPEND");
}

async function replaceTable(tableName: string, rows: Record<string, string>[]): Promise<void> {
  await loadNdjson(tableName, rows, "WRITE_TRUNCATE");
}

function seoulNow(): { date: string; datetime: string } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, datetime: `${date} ${parts.hour}:${parts.minute}` };
}

function parseSetId(v: string): string {
  const parsed = parseDistSetId(String(v || "").trim());
  if (!parsed) throw new Error("평가 배분 셋은 2026-08 또는 2026-08_ver1 형식으로 입력해주세요.");
  return parsed.id;
}

function parseCalendarMonth(v: string): string {
  const cal = calendarMonthOf(v);
  if (!/^\d{4}-\d{2}$/.test(cal)) throw new Error("평가 월은 2026-08 형식으로 입력해주세요.");
  return cal;
}

async function queryRows(query: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const [rows] = await getBQ().query({ query, params, ...loc() });
  return (rows as Record<string, unknown>[]) || [];
}

export async function assertNotLocked(month: string): Promise<void> {
  const rows = await queryRows(
    `
      SELECT 1 FROM ${distBq.sql(distBq.tables.monthLocks)}
      WHERE ${evalMonthWhereSql("eval_month")}
      LIMIT 1
    `,
    { month },
  );
  if (rows.length) throw new Error(`${month}은(는) 전체 확정 완료된 월이라 수정할 수 없어요.`);
}

function flattenTeams(teams: DistTeam[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  teams.forEach((t, i) => {
    const id = t.id || `T${String(i + 1).padStart(2, "0")}`;
    const chs = t.channels.length
      ? t.channels
      : [{ ch: "문의", on: true, aqt: 8, jobBe: 0, csBe: 0, note: "" }];
    for (const c of chs) {
      rows.push({
        team_id: id,
        team_on: t.on ? "TRUE" : "FALSE",
        team_name: t.name,
        evaluator_name: t.gp || "",
        headcount: String(t.ppl ?? 0),
        cs_mode: t.csMode || "normal",
        difficulty: String(t.difficulty ?? 1),
        cold_pct: String(t.cold ?? 0),
        channel_name: c.ch,
        channel_on: c.on !== false ? "TRUE" : "FALSE",
        aqt: String(c.aqt ?? 0),
        job_to_be: String(c.jobBe ?? 0),
        cs_to_be: String(c.csBe ?? 0),
        note: c.note || "",
      });
    }
  });
  return rows;
}

function flattenGps(gps: DistGp[]): Record<string, string>[] {
  return gps.map((g) => ({
    evaluator_name: g.name,
    evaluator_email: (g.email ?? "").toLowerCase(),
    avail_hours: String(g.avail ?? 4),
    buffer_pct: String(g.buffer ?? 0),
    cs_participate: g.cs ? "TRUE" : "FALSE",
    ratio_pct: String(g.ratio ?? 0),
    ratio_locked: g.locked ? "TRUE" : "FALSE",
  }));
}

function flattenAqt(aqtBase: Record<string, number>): Record<string, string>[] {
  return Object.entries(aqtBase).map(([channel, minutes]) => ({
    channel,
    aqt_minutes: String(minutes),
  }));
}

function flattenCfg(cfg: DistCfg): Record<string, string>[] {
  return [
    { key: "days", value: String(cfg.days ?? 15) },
    { key: "avail", value: String(cfg.avail ?? 4) },
    { key: "month", value: cfg.month || "" },
  ];
}

export async function savePlan(input: {
  cfg: DistCfg;
  teams: DistTeam[];
  gps: DistGp[];
  aqtBase: Record<string, number>;
}): Promise<void> {
  await ensureEvaluatorEmailColumns();
  await Promise.all([
    replaceTable(distBq.tables.teams, flattenTeams(input.teams)),
    replaceTable(distBq.tables.evaluators, flattenGps(input.gps)),
    replaceTable(distBq.tables.aqt, flattenAqt(input.aqtBase)),
    replaceTable(distBq.tables.config, flattenCfg(input.cfg)),
  ]);
}

type Keep = { manual: string; memo: string; editor: string; editedAt: string; evalItems: string };

async function getKeep(srcMonth: string): Promise<Record<string, Keep>> {
  if (!srcMonth) return {};
  try {
    const rows = await queryRows(
      `
        SELECT * FROM ${distBq.sql(distBq.tables.evalTargets)}
        WHERE ${evalMonthWhereSql("eval_month")}
      `,
      { month: srcMonth },
    );
    const snapRows = await queryRows(
      `
        SELECT * FROM ${distBq.sql(distBq.tables.evalTargetSnapshots)}
        WHERE ${evalMonthWhereSql("eval_month")}
      `,
      { month: srcMonth },
    ).catch(() => [] as Record<string, unknown>[]);
    const keep: Record<string, Keep> = {};
    for (const p of applySnapshotEvalItems(rows.map(parseRosterRow), snapRows)) {
      if (!p.employeeId) continue;
      keep[p.employeeId] = {
        manual: p.manualJudge,
        memo: p.memo,
        editor: p.editedBy,
        editedAt: p.editedAt,
        evalItems: p.evalItems.join(","),
      };
    }
    return keep;
  } catch (e) {
    console.warn("[evalOpsWrite] getKeep", e instanceof Error ? e.message : e);
    return {};
  }
}

function judgeLabels(kind: "target" | "excluded"): { auto: string; fin: string } {
  const auto = kind === "target" ? "대상" : "제외";
  return { auto, fin: auto };
}

function buildTargetRow(setId: string, emp: Record<string, unknown>, keep: Keep | undefined): Record<string, string> | null {
  const employeeId = cellStr(emp.employee_id);
  if (!employeeId) return null;
  const status = cellStr(emp.status);
  if (status === "퇴사") return null;
  const team = cellStr(emp.team_name);
  if (!team || isExcludedTeam(team)) return null;

  const cal = calendarMonthOf(setId);
  const ym = cal.split("-").map(Number);
  const evalIdx = ym[0] * 12 + ym[1];
  const exitDate = cellStr(emp.exit_date).slice(0, 10);
  if (exitDate) {
    const em = exitDate.match(/^(\d{4})-(\d{2})/);
    if (em) {
      const exitIdx = Number(em[1]) * 12 + Number(em[2]);
      if (exitIdx < evalIdx) return null;
    }
  }

  const level = cellStr(emp.level);
  const judged = judgeTarget({
    status,
    level,
    hireDate: cellStr(emp.hire_date).slice(0, 10) || null,
    convertDate: cellStr(emp.convert_date).slice(0, 10) || null,
    exitDate: exitDate || null,
    part: cellStr(emp.part),
    evalMonth: cal,
  });
  const { auto } = judgeLabels(judged.kind);
  const manual = keep?.manual || "";
  const finKind = finalJudge(judged.kind, manual);
  const fin = finKind === "target" ? "대상" : "제외";

  return {
    eval_month: setId,
    employee_id: employeeId,
    name_en: cellStr(emp.name_en),
    team_name: team,
    part: cellStr(emp.part),
    level,
    employment_type: cellStr(emp.employment_type),
    status,
    hire_date: cellStr(emp.hire_date).slice(0, 10),
    convert_date: cellStr(emp.convert_date).slice(0, 10),
    exit_date: exitDate,
    auto_judge: auto,
    manual_judge: manual,
    final_judge: fin,
    auto_note: judged.notes.join(", "),
    memo: keep?.memo || "",
    edited_by: keep?.editor || "",
    edited_at: keep?.editedAt || "",
    eval_items: keep?.evalItems || "",
  };
}

export async function createEvalMonth(opts: {
  month: string;
  copyFrom?: string;
  existing: EvalOpsBootstrap;
}): Promise<{ month: string; count: number; copiedFrom: string; keepCount: number }> {
  const cal = parseCalendarMonth(opts.month);
  const setId = nextDistSetId(cal, opts.existing.months);
  const copyFrom =
    (opts.copyFrom && isDistSetId(opts.copyFrom) ? parseDistSetId(opts.copyFrom)!.id : "") ||
    opts.existing.latestConfirmedSetId ||
    lastConfirmedSnapshot(opts.existing.history)?.month ||
    opts.existing.months[0] ||
    "";

  const histSnap = copyFrom ? latestHistoryForMonth(opts.existing.history, copyFrom) : null;
  const snap = histSnap?.planSnapshot;
  const curTeams = opts.existing.teams;
  const curGps = opts.existing.evaluators;
  const curAqt = opts.existing.aqtBase;
  const curCfg = opts.existing.cfg;
  const teams = snap?.teams?.length ? snap.teams : curTeams;
  let gps = snap?.gps?.length ? snap.gps : curGps;
  const aqtBase = snap?.aqtBase && Object.keys(snap.aqtBase).length ? snap.aqtBase : curAqt;
  const cfg: DistCfg = {
    days: snap?.cfg?.days ?? curCfg.days,
    avail: snap?.cfg?.avail ?? curCfg.avail,
    month: setId,
  };
  if ((!snap?.gps || !snap.gps.length) && histSnap?.ratios?.length) {
    const map = Object.fromEntries(histSnap.ratios.map((r) => [r.name, r.ratio]));
    gps = gps.map((g) => (map[g.name] != null ? { ...g, ratio: map[g.name] } : g));
  }
  await savePlan({ cfg, teams, gps, aqtBase });

  const keep = copyFrom ? await getKeep(copyFrom) : {};
  let hr: Record<string, unknown>[] = [];
  try {
    hr = await queryRows(`SELECT * FROM ${distBq.sql(distBq.tables.hrEmployees)} LIMIT 8000`);
  } catch (e) {
    throw new Error(
      `재직자 테이블(${distBq.tables.hrEmployees})을 읽지 못했어요. 시트 마이그레이션 후 다시 시도해주세요. ${
        e instanceof Error ? e.message : e
      }`,
    );
  }
  await ensureEvalItemsColumn();
  const rows = hr.map((r) => buildTargetRow(setId, r, keep[cellStr(r.employee_id)])).filter((x): x is Record<string, string> => !!x);
  if (!rows.length) throw new Error("재직자 명단에서 대상 인원을 찾지 못했어요. HR 적재(qradar_hr_employees)를 확인해주세요.");
  await insertFitted(distBq.tables.evalTargets, rows);
  return { month: setId, count: rows.length, copiedFrom: copyFrom, keepCount: Object.keys(keep).length };
}

export async function deleteEvalMonth(opts: {
  month: string;
  existing: EvalOpsBootstrap;
}): Promise<{ month: string }> {
  const month = parseSetId(opts.month);
  if (latestHistoryForMonth(opts.existing.history, month)) {
    throw new Error(`${month}은(는) 배분이 확정된 평가 배분 셋이라 삭제할 수 없어요. 같은 월의 새 버전을 만들어주세요.`);
  }
  const params = { month };
  await Promise.all([
    getBQ().query({
      query: `DELETE FROM ${distBq.sql(distBq.tables.evalTargets)} WHERE ${evalMonthWhereSql("eval_month")}`,
      params,
      ...loc(),
    }),
    getBQ().query({
      query: `DELETE FROM ${distBq.sql(distBq.tables.evalTargetSnapshots)} WHERE ${evalMonthWhereSql("eval_month")}`,
      params,
      ...loc(),
    }),
    getBQ().query({
      query: `DELETE FROM ${distBq.sql(distBq.tables.monthLocks)} WHERE ${evalMonthWhereSql("eval_month")}`,
      params,
      ...loc(),
    }),
  ]);
  return { month };
}

export async function syncEvalMonth(monthRaw: string): Promise<{ month: string; count: number }> {
  const month = parseSetId(monthRaw);
  await assertNotLocked(month);
  const existing = await queryRows(
    `SELECT 1 FROM ${distBq.sql(distBq.tables.evalTargets)} WHERE ${evalMonthWhereSql("eval_month")} LIMIT 1`,
    { month },
  );
  if (!existing.length) throw new Error(`${month} 월이 아직 생성되지 않았어요.`);
  const keep = await getKeep(month);
  await getBQ().query({
    query: `DELETE FROM ${distBq.sql(distBq.tables.evalTargets)} WHERE ${evalMonthWhereSql("eval_month")}`,
    params: { month },
    ...loc(),
  });
  const hr = await queryRows(`SELECT * FROM ${distBq.sql(distBq.tables.hrEmployees)} LIMIT 8000`);
  const rows = hr.map((r) => buildTargetRow(month, r, keep[cellStr(r.employee_id)])).filter((x): x is Record<string, string> => !!x);
  if (rows.length) await insertFitted(distBq.tables.evalTargets, rows);
  return { month, count: rows.length };
}

export async function patchRoster(opts: {
  month: string;
  employeeId: string;
  manual?: string | null;
  memo?: string | null;
  evalItems?: string[] | null;
  editor: string;
}): Promise<void> {
  const month = parseSetId(opts.month);
  await assertNotLocked(month);
  const rows = await queryRows(
    `
      SELECT * FROM ${distBq.sql(distBq.tables.evalTargets)}
      WHERE ${evalMonthWhereSql("eval_month")}
        AND CAST(employee_id AS STRING) = @id
      LIMIT 1
    `,
    { month, id: String(opts.employeeId) },
  );
  if (!rows.length) throw new Error(`${month} / 사번 ${opts.employeeId} 행을 찾지 못했어요.`);
  await ensureEvalItemsColumn();
  const cur = parseRosterRow(rows[0]);
  const manual = opts.manual !== undefined && opts.manual !== null ? String(opts.manual).replace(/[✅❌\s]/g, "") : cur.manualJudge;
  const memo = opts.memo !== undefined && opts.memo !== null ? String(opts.memo) : cur.memo;
  const evalItems =
    opts.evalItems !== undefined && opts.evalItems !== null ? opts.evalItems.join(",") : cur.evalItems.join(",");
  const fin = manual === "대상" ? "대상" : manual === "제외" ? "제외" : cur.autoJudge.replace(/[✅❌\s]/g, "") || cur.finalJudge;
  const { datetime } = seoulNow();
  await getBQ().query({
    query: `
      UPDATE ${distBq.sql(distBq.tables.evalTargets)}
      SET manual_judge = @manual,
          memo = @memo,
          eval_items = @evalItems,
          final_judge = @final,
          edited_by = @by,
          edited_at = @at
      WHERE ${evalMonthWhereSql("eval_month")}
        AND CAST(employee_id AS STRING) = @id
    `,
    params: {
      manual,
      memo,
      evalItems,
      final: fin,
      by: opts.editor,
      at: datetime,
      month,
      id: String(opts.employeeId),
    },
    ...loc(),
  });
}

export async function confirmTeam(opts: {
  month: string;
  team: string;
  editor: string;
}): Promise<{ month: string; team: string; count: number; by: string; at: string }> {
  const month = parseSetId(opts.month);
  await assertNotLocked(month);
  const team = String(opts.team || "").trim();
  if (!team) throw new Error("팀이 선택되지 않았어요.");
  const roster = await queryRows(
    `
      SELECT * FROM ${distBq.sql(distBq.tables.evalTargets)}
      WHERE ${evalMonthWhereSql("eval_month")}
        AND CAST(team_name AS STRING) = @team
    `,
    { month, team },
  );
  if (!roster.length) throw new Error(`"${team}" 팀 인원이 ${month} 명단에 없어요.`);
  await getBQ().query({
    query: `
      DELETE FROM ${distBq.sql(distBq.tables.evalTargetSnapshots)}
      WHERE ${evalMonthWhereSql("eval_month")}
        AND CAST(team_name AS STRING) = @team
    `,
    params: { month, team },
    ...loc(),
  });
  const { datetime } = seoulNow();
  const snaps = roster.map((r) => {
    const p = parseRosterRow(r);
    return {
      eval_month: month,
      employee_id: p.employeeId,
      name_en: p.nameEn,
      team_name: p.teamName,
      part: p.part,
      level: p.level,
      final_judge: p.finalJudge,
      auto_judge: p.autoJudge,
      manual_judge: p.manualJudge,
      auto_note: p.autoNote,
      memo: p.memo,
      eval_items: p.evalItems.join(","),
      edited_by: p.editedBy,
      edited_at: p.editedAt,
      confirmed_by: opts.editor,
      confirmed_at: datetime,
    };
  });
  await insertFitted(distBq.tables.evalTargetSnapshots, snaps);
  return { month, team, count: snaps.length, by: opts.editor, at: datetime };
}

export async function lockMonth(opts: { month: string; editor: string; roster: DistRosterPerson[]; confirmMap: Record<string, { by: string; at: string }> }): Promise<void> {
  const month = parseSetId(opts.month);
  await assertNotLocked(month);
  if (!opts.roster.length) throw new Error(`${month} 명단이 비어있어요.`);
  const teams = Array.from(new Set(opts.roster.map((p) => p.teamName || "(팀 미지정)")));
  const missing = teams.filter((t) => !opts.confirmMap[t]);
  if (missing.length) throw new Error(`아직 확정되지 않은 팀이 있어요: ${missing.join(", ")}`);
  const { datetime } = seoulNow();
  await insertFitted(distBq.tables.monthLocks, [
    { eval_month: month, confirmed_by: opts.editor, confirmed_at: datetime },
  ]);
}

async function nextHistoryId(dateStr: string): Promise<string> {
  const rows = await queryRows(
    `SELECT CAST(history_id AS STRING) AS history_id FROM ${distBq.sql(distBq.tables.assignHistory)} LIMIT 400`,
  );
  const re = new RegExp(`^${dateStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_ver(\\d+)$`);
  let maxVer = 0;
  for (const r of rows) {
    const m = cellStr(r.history_id).match(re);
    if (m) maxVer = Math.max(maxVer, Number(m[1]));
  }
  return `${dateStr}_ver${maxVer + 1}`;
}

export async function confirmAssign(opts: {
  month: string;
  editor: string;
  run: DistAssignRun;
  teams: DistTeam[];
  gps: DistGp[];
  aqtBase: Record<string, number>;
  cfg: DistCfg;
}): Promise<{ id: string }> {
  const month = parseSetId(opts.month);
  const already = await queryRows(
    `SELECT 1 FROM ${distBq.sql(distBq.tables.assignHistory)} WHERE ${evalMonthWhereSql("eval_month")} LIMIT 1`,
    { month },
  );
  if (already.length) {
    throw new Error(`${month}은(는) 이미 배분이 확정된 평가 배분 셋이에요. 조회만 가능합니다.`);
  }
  const { date, datetime } = seoulNow();
  const id = await nextHistoryId(date);
  await ensureEvaluatorEmailColumns();
  const emailByGp = new Map(opts.gps.map((g) => [g.name, (g.email ?? "").toLowerCase()]));
  const ratios = opts.gps.filter((g) => g.cs).map((g) => ({ name: g.name, ratio: g.ratio }));
  const meta = {
    metric: opts.run.metric,
    scope: opts.run.scope,
    id,
    teams: opts.teams,
    gps: opts.gps,
    aqtBase: opts.aqtBase,
    cfg: { ...opts.cfg, month },
  };
  await insertFitted(distBq.tables.assignHistory, [
    {
      eval_month: month,
      confirmed_by: opts.editor,
      confirmed_at: datetime,
      total_cs: String(opts.run.tCS ?? 0),
      prev_repeats: String(opts.run.repeats ?? 0),
      within_pm5: opts.run.withinRange ? "TRUE" : "FALSE",
      result_json: JSON.stringify(opts.run.result || {}),
      ratios_json: JSON.stringify(ratios),
      history_id: id,
      meta_json: JSON.stringify(meta),
    },
  ]);
  const details: Record<string, string>[] = [];
  for (const gn of Object.keys(opts.run.result || {})) {
    for (const u of opts.run.result[gn] || []) {
      if (u.kind === "job") continue;
      details.push({
        eval_month: month,
        evaluator_name: gn,
        evaluator_email: emailByGp.get(gn) ?? "",
        team_name: u.teamName,
        channel: u.ch || "",
        cs: String(u.cs ?? 0),
        unit_type: u.type === "member" ? "구성원" : u.type === "channel" ? "채널분리" : "팀전체",
        is_phone: u.isPhone ? "Y" : "",
        is_repeat: u.repeat ? "Y" : "",
        history_id: id,
        member_id: u.memberId || "",
        member_name: u.memberName || "",
      });
    }
  }
  if (details.length) await insertFitted(distBq.tables.assignDetail, details);
  return { id };
}
