import { randomUUID } from "node:crypto";
import { distBq } from "./bqRefs";
import { distRows, insertDistRows } from "./distDb";
import { cellStr, parseGps, parseJson, pick } from "./evalOpsStore";
import type { DistAssignUnit, DistGp } from "./distTypes";
import { calendarMonthOf, parseDistSetId } from "./distSet";
import { splitPerPersonCounts } from "./evalOpsSchedule";

export type ScheduleMember = {
  memberId: string;
  memberName: string;
  count: number;
};

export type EvalOpsScheduleBoardItem = {
  id: string;
  evalMonth: string;
  evaluatorEmail: string;
  teamName: string;
  evalType: "직무" | "CS";
  channel: string;
  memberCount: number;
  perPersonCount: number;
  totalCount: number;
  roundLabel: string;
  startDate: string | null;
  endDate: string | null;
  evalDone: boolean;
  leaderDone: boolean;
  selfDone: boolean;
  members: ScheduleMember[];
  sourceHistoryId: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type EvalOpsPersonalEvent = {
  id: string;
  evalMonth: string;
  ownerEmail: string;
  title: string;
  startDate: string;
  endDate: string | null;
  color: string;
  createdAt?: string;
  updatedAt?: string;
};

/** @deprecated flat assign units — kept for bootstrap grouping only */
export type EvalOpsScheduleItem = {
  id: string;
  evalMonth: string;
  historyId: string;
  evaluatorName: string;
  evaluatorEmail: string;
  teamName: string;
  channel: string;
  cs: number;
  job: number;
  kind: "cs" | "job";
  unitType: string;
  memberId: string;
  memberName: string;
  isRepeat: boolean;
  isPhone: boolean;
};

// 평가자 일정 보드. 원천은 서빙 Postgres(테이블 이름은 BQ 와 같다), BQ 는 야간 덤프 사본.
const itemsSql = () => distBq.tables.scheduleItems;
const personalSql = () => distBq.tables.schedulePersonal;

function tsValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) {
    return String((v as { value: string }).value);
  }
  return String(v ?? "");
}

function dateValue(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "object" && v && "value" in v) return String((v as { value: string }).value).slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function boolValue(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function parseMembers(raw: unknown): ScheduleMember[] {
  const arr = parseJson<unknown[]>(typeof raw === "string" ? raw : JSON.stringify(raw ?? []), []);
  if (!Array.isArray(arr)) return [];
  return arr.map((m) => {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    return {
      memberId: String(o.memberId ?? o.member_id ?? ""),
      memberName: String(o.memberName ?? o.member_name ?? ""),
      count: Number(o.count) || 0,
    };
  });
}

function rowToBoardItem(r: Record<string, unknown>): EvalOpsScheduleBoardItem {
  const evalType = cellStr(r.eval_type) === "직무" ? "직무" : "CS";
  return {
    id: cellStr(r.id),
    evalMonth: cellStr(r.eval_month),
    evaluatorEmail: cellStr(r.evaluator_email).toLowerCase(),
    teamName: cellStr(r.team_name),
    evalType,
    channel: cellStr(r.channel),
    memberCount: Number(r.member_count) || 0,
    perPersonCount: Number(r.per_person_count) || 0,
    totalCount: Number(r.total_count) || 0,
    roundLabel: cellStr(r.round_label) || "1회차",
    startDate: dateValue(r.start_date),
    endDate: dateValue(r.end_date),
    evalDone: boolValue(r.eval_done),
    leaderDone: boolValue(r.leader_done),
    selfDone: boolValue(r.self_done),
    members: parseMembers(r.members_json),
    sourceHistoryId: cellStr(r.source_history_id) || null,
    createdAt: tsValue(r.created_at) || undefined,
    updatedAt: tsValue(r.updated_at) || undefined,
  };
}

function rowToPersonal(r: Record<string, unknown>): EvalOpsPersonalEvent {
  return {
    id: cellStr(r.id),
    evalMonth: cellStr(r.eval_month),
    ownerEmail: cellStr(r.owner_email).toLowerCase(),
    title: cellStr(r.title),
    startDate: dateValue(r.start_date) || "",
    endDate: dateValue(r.end_date),
    color: cellStr(r.color) || "#4d82d6",
    createdAt: tsValue(r.created_at) || undefined,
    updatedAt: tsValue(r.updated_at) || undefined,
  };
}

async function latestHistoryRow(monthOrSetId: string): Promise<Record<string, unknown> | null> {
  const cal = calendarMonthOf(monthOrSetId);
  const rows = await distRows(
    `
      SELECT *
      FROM ${distBq.tables.assignHistory}
      WHERE eval_month::text = @setId
         OR eval_month::text = @calMonth
         OR starts_with(eval_month::text, @calPrefix)
      ORDER BY
        CASE WHEN history_id IS NULL OR history_id = '' THEN 1 ELSE 0 END,
        history_id COLLATE "C" DESC NULLS LAST
      LIMIT 1`,
    { setId: monthOrSetId, calMonth: cal, calPrefix: `${cal}_ver` },
  );
  return rows[0] ?? null;
}

async function currentEvaluatorEmails(): Promise<Map<string, string>> {
  try {
    const rows = await distRows(`SELECT * FROM ${distBq.tables.evaluators} ORDER BY _row_id LIMIT 80`);
    const map = new Map<string, string>();
    for (const g of parseGps(rows)) {
      if (g.name && g.email) map.set(g.name, g.email.toLowerCase());
    }
    return map;
  } catch {
    return new Map();
  }
}

function emailForGp(name: string, metaGps: DistGp[], live: Map<string, string>): string {
  const fromMeta = metaGps.find((g) => g.name === name)?.email?.toLowerCase();
  if (fromMeta) return fromMeta;
  return live.get(name) ?? "";
}

function unitTypeLabel(type: DistAssignUnit["type"]): string {
  if (type === "member") return "구성원";
  if (type === "channel") return "채널분리";
  return "팀전체";
}

/** Flat assign units for this evaluator (from latest confirmed history). */
export async function getAssignUnitsForEvaluator(opts: {
  month: string;
  evaluatorEmail: string;
}): Promise<{
  month: string;
  historyId: string | null;
  units: Array<EvalOpsScheduleItem & { _unit: DistAssignUnit }>;
  unmatchedReason?: string;
}> {
  const parsed = parseDistSetId(opts.month);
  const month = parsed?.month ?? calendarMonthOf(opts.month);
  const setId = parsed?.id ?? opts.month;
  const email = opts.evaluatorEmail.trim().toLowerCase();
  if (!email) return { month, historyId: null, units: [], unmatchedReason: "이메일이 없습니다." };

  const hist = await latestHistoryRow(setId);
  if (!hist) return { month, historyId: null, units: [] };

  const historyId =
    cellStr(pick(hist, "history_id")) ||
    cellStr(parseJson<Record<string, unknown>>(pick(hist, "meta_json"), {}).id) ||
    "unknown";

  const meta = parseJson<Record<string, unknown>>(pick(hist, "meta_json"), {});
  const metaGps = (meta.gps as DistGp[]) ?? [];
  const result = parseJson<Record<string, DistAssignUnit[]>>(pick(hist, "result_json", "result"), {});
  const liveEmails = await currentEvaluatorEmails();

  const matchedNames = Object.keys(result).filter((name) => emailForGp(name, metaGps, liveEmails) === email);

  if (!matchedNames.length) {
    const anyMapped = Object.keys(result).some((name) => !!emailForGp(name, metaGps, liveEmails));
    return {
      month,
      historyId,
      units: [],
      unmatchedReason: anyMapped
        ? `확정 배분(${historyId})에 ${email}로 매핑된 평가자가 없습니다. 평가자 탭에서 이메일을 연결하세요.`
        : `확정 배분(${historyId})은 있으나 평가자 이메일이 아직 매핑되지 않았습니다. 평가 배분 → 평가자 탭에서 Slack 이메일을 연결·저장한 뒤 다시 열어주세요.`,
    };
  }

  const typed: Array<EvalOpsScheduleItem & { _unit: DistAssignUnit }> = [];
  let idx = 0;
  for (const evaluatorName of matchedNames) {
    for (const u of result[evaluatorName] || []) {
      idx += 1;
      typed.push({
        id: `${historyId}-${idx}`,
        evalMonth: month,
        historyId,
        evaluatorName,
        evaluatorEmail: email,
        teamName: u.teamName || "",
        channel: u.ch || "",
        cs: Number(u.cs) || 0,
        job: Number(u.job) || 0,
        kind: u.kind === "job" ? "job" : "cs",
        unitType: unitTypeLabel(u.type),
        memberId: u.memberId || "",
        memberName: u.memberName || "",
        isRepeat: !!u.repeat,
        isPhone: !!u.isPhone,
        _unit: u,
      });
    }
  }

  return { month, historyId, units: typed };
}

export function groupAssignUnitsToBoardItems(opts: {
  month: string;
  evaluatorEmail: string;
  historyId: string;
  units: Array<EvalOpsScheduleItem & { _unit?: DistAssignUnit }>;
}): EvalOpsScheduleBoardItem[] {
  type Bucket = { teamName: string; evalType: "직무" | "CS"; channel: string; units: DistAssignUnit[] };
  const map = new Map<string, Bucket>();

  for (const row of opts.units) {
    const u = row._unit ?? {
      teamName: row.teamName,
      ch: row.channel,
      isPhone: row.isPhone,
      ppl: 1,
      cs: row.cs,
      job: row.job,
      aqt: 0,
      type: (row.memberId ? "member" : "team") as DistAssignUnit["type"],
      kind: row.kind,
      memberId: row.memberId,
      memberName: row.memberName,
    };
    const evalType: "직무" | "CS" = u.kind === "job" ? "직무" : "CS";
    const key = `${u.teamName}\0${evalType}\0${u.ch || ""}`;
    if (!map.has(key)) {
      map.set(key, { teamName: u.teamName || "", evalType, channel: u.ch || "", units: [] });
    }
    map.get(key)!.units.push(u);
  }

  const items: EvalOpsScheduleBoardItem[] = [];
  for (const b of map.values()) {
    const members: ScheduleMember[] = [];
    for (const u of b.units) {
      const count = u.kind === "job" ? Number(u.job) || 0 : Number(u.cs) || 0;
      if (u.type === "member" || u.memberId || u.memberName) {
        members.push({
          memberId: u.memberId || "",
          memberName: u.memberName || u.memberId || "?",
          count,
        });
      } else {
        const ppl = Math.max(1, Number(u.ppl) || 1);
        const base = Math.floor(count / ppl);
        const rem = count % ppl;
        for (let i = 0; i < ppl; i++) {
          members.push({
            memberId: `_slot_${b.teamName}_${b.channel}_${i}`,
            memberName: `${b.teamName}${b.channel ? ` · ${b.channel}` : ""} #${i + 1}`,
            count: base + (i < rem ? 1 : 0),
          });
        }
      }
    }

    // merge duplicate memberIds
    const merged = new Map<string, ScheduleMember>();
    for (const m of members) {
      const k = m.memberId || m.memberName;
      const prev = merged.get(k);
      if (prev) prev.count += m.count;
      else merged.set(k, { ...m });
    }
    const memberList = [...merged.values()];
    const memberCount = memberList.length;
    const totalFromMembers = memberList.reduce((s, m) => s + m.count, 0);
    const counts = memberList.map((m) => m.count);
    const allSame = counts.length > 0 && counts.every((c) => c === counts[0]);
    const perPersonCount = memberCount
      ? allSame
        ? counts[0]
        : Math.max(1, Math.round(totalFromMembers / memberCount))
      : 0;
    const totalCount = memberCount * perPersonCount;

    items.push({
      id: randomUUID(),
      evalMonth: opts.month,
      evaluatorEmail: opts.evaluatorEmail.toLowerCase(),
      teamName: b.teamName,
      evalType: b.evalType,
      channel: b.channel,
      memberCount,
      perPersonCount,
      totalCount,
      roundLabel: "1회차",
      startDate: null,
      endDate: null,
      evalDone: false,
      leaderDone: false,
      selfDone: false,
      members: memberList.map((m) => ({
        ...m,
        count: allSame ? perPersonCount : m.count,
      })),
      sourceHistoryId: opts.historyId,
    });
  }

  items.sort(
    (a, b) =>
      a.teamName.localeCompare(b.teamName, "ko") ||
      a.evalType.localeCompare(b.evalType, "ko") ||
      a.channel.localeCompare(b.channel, "ko"),
  );
  return items;
}

function boardItemToRow(item: EvalOpsScheduleBoardItem, now: string): Record<string, unknown> {
  return {
    id: item.id,
    eval_month: item.evalMonth,
    team_name: item.teamName,
    eval_type: item.evalType,
    channel: item.channel,
    member_count: item.memberCount,
    per_person_count: item.perPersonCount,
    total_count: item.totalCount,
    round_label: item.roundLabel,
    start_date: item.startDate || null,
    end_date: item.endDate || null,
    eval_done: item.evalDone,
    leader_done: item.leaderDone,
    self_done: item.selfDone,
    created_at: item.createdAt || now,
    updated_at: item.updatedAt || now,
    evaluator_email: item.evaluatorEmail,
    members_json: JSON.stringify(item.members),
    source_history_id: item.sourceHistoryId || "",
  };
}

async function insertBoardItems(items: EvalOpsScheduleBoardItem[]): Promise<void> {
  if (!items.length) return;
  const now = new Date().toISOString();
  await insertDistRows(itemsSql(), items.map((item) => boardItemToRow(item, now)));
}

async function insertBoardItem(item: EvalOpsScheduleBoardItem): Promise<void> {
  await insertBoardItems([item]);
}

export async function listScheduleItems(opts: {
  month: string;
  evaluatorEmail: string;
}): Promise<EvalOpsScheduleBoardItem[]> {
  const email = opts.evaluatorEmail.trim().toLowerCase();
  const rows = await distRows(
    `
      SELECT *
      FROM ${itemsSql()}
      WHERE eval_month = @month AND LOWER(evaluator_email) = @email
      ORDER BY team_name COLLATE "C", eval_type COLLATE "C", channel COLLATE "C", round_label COLLATE "C", id COLLATE "C"`,
    { month: opts.month, email },
  );
  return rows.map(rowToBoardItem);
}

export async function listPersonalEvents(opts: {
  month: string;
  ownerEmail: string;
}): Promise<EvalOpsPersonalEvent[]> {
  const email = opts.ownerEmail.trim().toLowerCase();
  const rows = await distRows(
    `
      SELECT *
      FROM ${personalSql()}
      WHERE eval_month = @month AND LOWER(owner_email) = @email
      ORDER BY start_date, id COLLATE "C"`,
    { month: opts.month, email },
  );
  return rows.map(rowToPersonal);
}

export async function getScheduleBoard(opts: {
  month: string;
  evaluatorEmail: string;
  autoSeed?: boolean;
}): Promise<{
  month: string;
  historyId: string | null;
  items: EvalOpsScheduleBoardItem[];
  personal: EvalOpsPersonalEvent[];
  seeded: boolean;
  unmatchedReason?: string;
}> {
  const parsed = parseDistSetId(opts.month);
  const month = parsed?.month ?? calendarMonthOf(opts.month);
  const email = opts.evaluatorEmail.trim().toLowerCase();

  let items = await listScheduleItems({ month, evaluatorEmail: email });
  const personal = await listPersonalEvents({ month, ownerEmail: email });
  let seeded = false;
  let historyId: string | null = items[0]?.sourceHistoryId ?? null;
  let unmatchedReason: string | undefined;

  if (!items.length && opts.autoSeed !== false) {
    const boot = await bootstrapFromAssign({ month, evaluatorEmail: email, force: false });
    items = boot.items;
    historyId = boot.historyId;
    seeded = boot.seeded;
    unmatchedReason = boot.unmatchedReason;
  }

  return { month, historyId, items, personal, seeded, unmatchedReason };
}

export async function bootstrapFromAssign(opts: {
  month: string;
  evaluatorEmail: string;
  force?: boolean;
}): Promise<{
  month: string;
  historyId: string | null;
  items: EvalOpsScheduleBoardItem[];
  seeded: boolean;
  unmatchedReason?: string;
  error?: string;
}> {
  const parsed = parseDistSetId(opts.month);
  const month = parsed?.month ?? calendarMonthOf(opts.month);
  const email = opts.evaluatorEmail.trim().toLowerCase();

  const existing = await listScheduleItems({ month, evaluatorEmail: email });
  if (existing.length && !opts.force) {
    const hasScheduled = existing.some((i) => i.startDate);
    if (hasScheduled) {
      return {
        month,
        historyId: existing[0]?.sourceHistoryId ?? null,
        items: existing,
        seeded: false,
        error: "이미 캘린더에 배치된 항목이 있습니다. 강제 불러오기를 사용하세요.",
      };
    }
  }

  const assign = await getAssignUnitsForEvaluator({ month, evaluatorEmail: email });
  if (!assign.historyId) {
    return { month, historyId: null, items: existing, seeded: false };
  }
  if (!assign.units.length) {
    return {
      month,
      historyId: assign.historyId,
      items: existing,
      seeded: false,
      unmatchedReason: assign.unmatchedReason,
    };
  }

  // Replace this evaluator+month rows
  await distRows(`DELETE FROM ${itemsSql()} WHERE eval_month = @month AND LOWER(evaluator_email) = @email`, {
    month,
    email,
  });

  const boardItems = groupAssignUnitsToBoardItems({
    month,
    evaluatorEmail: email,
    historyId: assign.historyId,
    units: assign.units,
  });

  await insertBoardItems(boardItems);

  return {
    month,
    historyId: assign.historyId,
    items: boardItems,
    seeded: true,
    unmatchedReason: assign.unmatchedReason,
  };
}

export type ScheduleItemPatch = {
  start?: string | null;
  end?: string | null;
  evalDone?: boolean;
  leaderDone?: boolean;
  selfDone?: boolean;
};

export async function patchScheduleItem(opts: {
  id: string;
  evaluatorEmail: string;
  fields: ScheduleItemPatch;
}): Promise<EvalOpsScheduleBoardItem | null> {
  const email = opts.evaluatorEmail.trim().toLowerCase();
  const rows = await distRows(`SELECT * FROM ${itemsSql()} WHERE id = @id AND LOWER(evaluator_email) = @email LIMIT 1`, {
    id: opts.id,
    email,
  });
  const row = rows[0];
  if (!row) return null;

  const cur = rowToBoardItem(row);
  let startDate = cur.startDate;
  let endDate = cur.endDate;
  let evalDone = cur.evalDone;
  let leaderDone = cur.leaderDone;
  let selfDone = cur.selfDone;

  if ("start" in opts.fields) {
    const v = opts.fields.start;
    startDate = v && String(v).trim() ? String(v).slice(0, 10) : null;
  }
  if ("end" in opts.fields) {
    const v = opts.fields.end;
    endDate = v && String(v).trim() ? String(v).slice(0, 10) : null;
  }
  if (typeof opts.fields.evalDone === "boolean") {
    evalDone = opts.fields.evalDone;
    if (!evalDone) {
      leaderDone = false;
      selfDone = false;
    }
  }
  if (typeof opts.fields.leaderDone === "boolean") {
    leaderDone = evalDone ? opts.fields.leaderDone : false;
  }
  if (typeof opts.fields.selfDone === "boolean") {
    selfDone = evalDone ? opts.fields.selfDone : false;
  }
  if (startDate && endDate && endDate < startDate) {
    endDate = startDate;
  }
  if (startDate && !endDate) endDate = startDate;

  const now = new Date().toISOString();
  await distRows(
    `
      UPDATE ${itemsSql()}
      SET
        start_date = ${startDate ? "@start_date::date" : "NULL"},
        end_date = ${endDate ? "@end_date::date" : "NULL"},
        eval_done = @eval_done,
        leader_done = @leader_done,
        self_done = @self_done,
        updated_at = @updated_at::timestamptz
      WHERE id = @id AND LOWER(evaluator_email) = @email`,
    {
      id: opts.id,
      email,
      ...(startDate ? { start_date: startDate } : {}),
      ...(endDate ? { end_date: endDate } : {}),
      eval_done: evalDone,
      leader_done: leaderDone,
      self_done: selfDone,
      updated_at: now,
    },
  );

  return {
    ...cur,
    startDate,
    endDate,
    evalDone,
    leaderDone,
    selfDone,
    updatedAt: now,
  };
}

export async function splitScheduleItem(opts: {
  id: string;
  evaluatorEmail: string;
}): Promise<{ original: EvalOpsScheduleBoardItem; created: EvalOpsScheduleBoardItem } | { error: string }> {
  const email = opts.evaluatorEmail.trim().toLowerCase();
  const rows = await distRows(`SELECT * FROM ${itemsSql()} WHERE id = @id AND LOWER(evaluator_email) = @email LIMIT 1`, {
    id: opts.id,
    email,
  });
  const row = rows[0];
  if (!row) return { error: "항목을 찾을 수 없습니다." };

  const cur = rowToBoardItem(row);
  const split = splitPerPersonCounts(cur.perPersonCount);
  if (!split) return { error: "인당 1건 이하는 쪼갤 수 없습니다." };

  const members1 = cur.members.map((m) => {
    const s = splitPerPersonCounts(m.count);
    return { ...m, count: s ? s.first : Math.ceil(m.count / 2) };
  });
  const members2 = cur.members.map((m) => {
    const s = splitPerPersonCounts(m.count);
    return { memberId: m.memberId, memberName: m.memberName, count: s ? s.second : Math.floor(m.count / 2) };
  });

  const now = new Date().toISOString();
  const original: EvalOpsScheduleBoardItem = {
    ...cur,
    roundLabel: "1회차",
    perPersonCount: split.first,
    totalCount: cur.memberCount * split.first,
    members: members1,
    updatedAt: now,
  };
  const created: EvalOpsScheduleBoardItem = {
    ...cur,
    id: randomUUID(),
    roundLabel: "2회차",
    perPersonCount: split.second,
    totalCount: cur.memberCount * split.second,
    members: members2,
    startDate: null,
    endDate: null,
    evalDone: false,
    leaderDone: false,
    selfDone: false,
    createdAt: now,
    updatedAt: now,
  };

  await distRows(
    `
      UPDATE ${itemsSql()}
      SET
        round_label = @round_label,
        per_person_count = @per_person_count,
        total_count = @total_count,
        members_json = @members_json,
        updated_at = @updated_at::timestamptz
      WHERE id = @id AND LOWER(evaluator_email) = @email`,
    {
      id: original.id,
      email,
      round_label: original.roundLabel,
      per_person_count: original.perPersonCount,
      total_count: original.totalCount,
      members_json: JSON.stringify(original.members),
      updated_at: now,
    },
  );

  await insertBoardItem(created);
  return { original, created };
}

export async function upsertPersonalEvent(opts: {
  event: Partial<EvalOpsPersonalEvent> & {
    evalMonth: string;
    ownerEmail: string;
    title: string;
    startDate: string;
  };
}): Promise<EvalOpsPersonalEvent> {
  const email = opts.event.ownerEmail.trim().toLowerCase();
  const id = opts.event.id?.trim() || randomUUID();
  const now = new Date().toISOString();
  const endDate = opts.event.endDate?.trim() || opts.event.startDate;
  const color = opts.event.color || "#4d82d6";

  // delete then insert (upsert)
  await distRows(`DELETE FROM ${personalSql()} WHERE id = @id AND LOWER(owner_email) = @email`, { id, email });

  await distRows(
    `
      INSERT INTO ${personalSql()} (
        id, eval_month, owner_email, title, start_date, end_date, color, created_at, updated_at
      ) VALUES (
        @id, @eval_month, @owner_email, @title,
        @start_date::date, @end_date::date, @color,
        @created_at::timestamptz, @updated_at::timestamptz
      )`,
    {
      id,
      eval_month: opts.event.evalMonth,
      owner_email: email,
      title: opts.event.title.trim(),
      start_date: opts.event.startDate.slice(0, 10),
      end_date: endDate.slice(0, 10),
      color,
      created_at: opts.event.createdAt || now,
      updated_at: now,
    },
  );

  return {
    id,
    evalMonth: opts.event.evalMonth,
    ownerEmail: email,
    title: opts.event.title.trim(),
    startDate: opts.event.startDate.slice(0, 10),
    endDate: endDate.slice(0, 10),
    color,
    createdAt: opts.event.createdAt || now,
    updatedAt: now,
  };
}

export async function deletePersonalEvent(opts: {
  id: string;
  ownerEmail: string;
}): Promise<boolean> {
  const email = opts.ownerEmail.trim().toLowerCase();
  await distRows(`DELETE FROM ${personalSql()} WHERE id = @id AND LOWER(owner_email) = @email`, { id: opts.id, email });
  return true;
}

/** Back-compat: flat list used by older schedule GET consumers */
export async function getScheduleForEvaluator(opts: {
  month: string;
  evaluatorEmail: string;
}): Promise<{
  month: string;
  historyId: string | null;
  items: EvalOpsScheduleItem[];
  unmatchedReason?: string;
}> {
  const r = await getAssignUnitsForEvaluator(opts);
  return {
    month: r.month,
    historyId: r.historyId,
    items: r.units.map(({ _unit: _u, ...rest }) => rest),
    unmatchedReason: r.unmatchedReason,
  };
}
