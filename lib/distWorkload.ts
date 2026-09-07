/** 일감 정량화 — GAS index.html getCS / AQT / COLD 가산 이식. */

import type {
  DistAssignMetric,
  DistAssignResult,
  DistAssignUnit,
  DistCfg,
  DistChannel,
  DistGp,
  DistManHourRow,
  DistRosterPerson,
  DistTeam,
} from "./distTypes";

export function isTargetPerson(p: DistRosterPerson): boolean {
  return p.judgeKind === "target" || String(p.finalJudge).includes("대상");
}

export function parseEvalItems(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return raw.flatMap((x) => parseEvalItems(x)).filter(Boolean);
  if (typeof raw === "object") {
    if (raw instanceof Date) return [];
    if ("value" in raw) return parseEvalItems((raw as { value: unknown }).value);
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) return parseEvalItems(parsed);
    } catch {
      /* comma-separated fallback */
    }
  }
  return s
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function isRegularCS(t: DistTeam): boolean {
  return (t.csMode || "normal") === "normal";
}

export function getDiff(t: DistTeam): number {
  return Math.max(0.5, Math.min(2, Number(t.difficulty) || 1));
}

export function actCh(t: DistTeam): DistChannel[] {
  return t.channels.filter((c) => c.on !== false);
}

export function allocTotal(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const tot = Math.max(0, Math.round(total));
  const wsum = weights.reduce((s, w) => s + Math.max(0, +w || 0), 0);
  const raw = wsum <= 0 ? weights.map(() => tot / n) : weights.map((w) => (tot * Math.max(0, +w || 0)) / wsum);
  const vals = raw.map((v) => Math.floor(v));
  let rem = tot - vals.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) vals[order[k % order.length].i]++;
  return vals;
}

export function effCh(t: DistTeam): Array<DistChannel & { redistributed?: boolean }> {
  const active = actCh(t);
  if (!active.length) return [];
  const totalJob = t.channels.reduce((s, c) => s + (+c.jobBe || 0), 0);
  const totalCs = t.channels.reduce((s, c) => s + (+c.csBe || 0), 0);
  const jobs = allocTotal(
    totalJob,
    active.map((c) => +c.jobBe || 0),
  );
  const css = allocTotal(
    totalCs,
    active.map((c) => +c.csBe || 0),
  );
  const hasOff = t.channels.some((c) => c.on === false && ((+c.jobBe || 0) > 0 || (+c.csBe || 0) > 0));
  return active.map((c, i) => ({
    ...c,
    jobBe: jobs[i] || 0,
    csBe: css[i] || 0,
    redistributed: hasOff,
  }));
}

export function getDefAQT(ch: string, aqtBase: Record<string, number>): number {
  if (ch.includes("전화")) return aqtBase["전화"] || 15;
  if (ch.includes("채팅")) return aqtBase["채팅"] || 8;
  if (ch.includes("티켓")) return aqtBase["티켓"] || 8;
  if (ch.includes("심사")) return aqtBase["심사"] || 7;
  return aqtBase["문의"] || 8;
}

export function channelMembers(
  roster: DistRosterPerson[],
  teamName: string,
  ch: string,
): DistRosterPerson[] {
  return roster.filter(
    (p) => p.teamName === teamName && isTargetPerson(p) && p.evalItems.includes(ch),
  );
}

export function channelEvalPpl(roster: DistRosterPerson[], teams: DistTeam[], teamName: string, ch: string): number {
  if (roster.length) {
    const mems = channelMembers(roster, teamName, ch);
    if (mems.length) return mems.length;
    if (roster.some((p) => p.teamName === teamName && isTargetPerson(p))) return 0;
  }
  const t = teams.find((x) => x.name === teamName);
  return t ? +t.ppl || 0 : 0;
}

export function getChannelJobTotal(roster: DistRosterPerson[], teams: DistTeam[], t: DistTeam, c: DistChannel): number {
  return channelEvalPpl(roster, teams, t.name, c.ch) * (+c.jobBe || 0);
}

export function getChannelCsTotal(roster: DistRosterPerson[], teams: DistTeam[], t: DistTeam, c: DistChannel): number {
  return channelEvalPpl(roster, teams, t.name, c.ch) * (+c.csBe || 0);
}

export function getJobTotal(roster: DistRosterPerson[], teams: DistTeam[], t: DistTeam): number {
  return effCh(t).reduce((s, c) => s + getChannelJobTotal(roster, teams, t, c), 0);
}

export function getCS(roster: DistRosterPerson[], teams: DistTeam[], t: DistTeam): number {
  return effCh(t).reduce((s, c) => s + getChannelCsTotal(roster, teams, t, c), 0);
}

export function hasPhone(t: DistTeam): boolean {
  return effCh(t).some((c) => c.ch.includes("전화"));
}

export function getChLabel(t: DistTeam): string {
  return effCh(t)
    .map((c) => c.ch + (c.redistributed ? "*" : "") + (c.note ? ` (${c.note})` : ""))
    .join("+");
}

export function hasMultipleCsChannels(t: DistTeam): boolean {
  return effCh(t).filter((c) => (c.csBe || 0) > 0).length > 1;
}

export function getTeamAQT(t: DistTeam, aqtBase: Record<string, number>): number {
  const acs = effCh(t);
  const tcb = acs.reduce((s, c) => s + (+c.csBe || 0), 0);
  if (tcb === 0) {
    const tj = acs.reduce((s, c) => s + c.jobBe, 0);
    if (!tj) return 8;
    return acs.reduce((s, c) => s + (c.aqt || getDefAQT(c.ch, aqtBase)) * c.jobBe, 0) / tj;
  }
  return acs.reduce((s, c) => s + (+c.csBe || 0) * (c.aqt || getDefAQT(c.ch, aqtBase)), 0) / tcb;
}

/** 건당 소요분 = (채널 AQT + COLD%/100×5) × 난이도 */
export function getTeamWorkAQT(t: DistTeam, aqtBase: Record<string, number>): number {
  return (getTeamAQT(t, aqtBase) + (t.cold || 0) / 100 * 5) * getDiff(t);
}

export function getChannelWorkAQT(t: DistTeam, c: DistChannel, aqtBase: Record<string, number>): number {
  return ((c.aqt || getDefAQT(c.ch, aqtBase)) + (t.cold || 0) / 100 * 5) * getDiff(t);
}

/** COLD%/100 × 5 — 난이도 적용 전 건당 가산 분 */
export function getChannelColdAddMin(t: DistTeam): number {
  return ((t.cold || 0) / 100) * 5;
}

export function getChannelPerPersonMin(t: DistTeam, c: DistChannel, aqtBase: Record<string, number>): number {
  return getChannelWorkAQT(t, c, aqtBase) * ((+c.jobBe || 0) + (+c.csBe || 0));
}

export function getChannelTotalMin(
  roster: DistRosterPerson[],
  teams: DistTeam[],
  t: DistTeam,
  c: DistChannel,
  aqtBase: Record<string, number>,
): number {
  return getChannelWorkAQT(t, c, aqtBase) * (getChannelJobTotal(roster, teams, t, c) + getChannelCsTotal(roster, teams, t, c));
}

export function fmtMin(m: number): string {
  const n = Math.round((+m || 0) * 10) / 10;
  if (n >= 60) return `${Math.round((n / 60) * 10) / 10}h`;
  return `${n}분`;
}

export function getCsModeLabel(mode: string): string {
  if (mode === "eventOnly") return "발생시";
  if (mode === "exclude") return "제외";
  return "정규";
}

export function getJobWorkAQT(t: DistTeam, aqtBase: Record<string, number>): number {
  const acs = effCh(t);
  const tj = acs.reduce((s, c) => s + c.jobBe, 0);
  if (!tj) return 8;
  const avg = acs.reduce((s, c) => s + (c.aqt || getDefAQT(c.ch, aqtBase)) * c.jobBe, 0) / tj;
  return (avg + (t.cold || 0) / 100 * 5) * getDiff(t);
}

export function teamHasWorkload(roster: DistRosterPerson[], teams: DistTeam[], t: DistTeam): boolean {
  if (!t || !t.on) return false;
  return getJobTotal(roster, teams, t) > 0 || (isRegularCS(t) && getCS(roster, teams, t) > 0);
}

export function metricOf(u: DistAssignUnit, metric: DistAssignMetric): number {
  const n = u.kind === "job" ? +u.job || 0 : +u.cs || 0;
  return metric === "time" ? n * (+u.aqt || 10) : n;
}

export function formatMetric(v: number, metric: DistAssignMetric): string {
  if (metric === "time") {
    const h = v / 60;
    return `${h >= 10 ? h.toFixed(1) : h.toFixed(2)}h`;
  }
  return `${Math.round(v)}건`;
}

/** 배분 그래프 캡션용. 예: 직무 3시간 / CS 4시간 도합 7시간 (33%) */
export function formatMetricKo(v: number, metric: DistAssignMetric): string {
  if (metric === "time") {
    const h = v / 60;
    const n = h >= 10 ? h.toFixed(1) : Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : h.toFixed(1);
    return `${n}시간`;
  }
  return `${Math.round(v)}건`;
}

export function buildJobUnits(
  roster: DistRosterPerson[],
  teams: DistTeam[],
  aqtBase: Record<string, number>,
): DistAssignUnit[] {
  return teams
    .filter((t) => teamHasWorkload(roster, teams, t) && getJobTotal(roster, teams, t) > 0)
    .map((t) => ({
      teamName: t.name,
      ch: getChLabel(t),
      isPhone: hasPhone(t),
      ppl: t.ppl,
      cs: 0,
      job: getJobTotal(roster, teams, t),
      aqt: getJobWorkAQT(t, aqtBase),
      type: "team" as const,
      kind: "job" as const,
    }));
}

function resolveMembers(
  roster: DistRosterPerson[],
  teams: DistTeam[],
  teamName: string,
  ch: string,
): DistRosterPerson[] {
  const mems = channelMembers(roster, teamName, ch);
  if (mems.length) return mems;
  if (roster.length && roster.some((p) => p.teamName === teamName && isTargetPerson(p))) return [];
  const t = teams.find((x) => x.name === teamName);
  const n = t ? +t.ppl || 0 : 0;
  return Array.from({ length: n }, (_, i) => ({
    employeeId: `_syn_${teamName}_${i}`,
    nameEn: `구성원${i + 1}`,
    teamName,
    part: "",
    level: "",
    employmentType: "",
    status: "",
    hireDate: "",
    convertDate: "",
    exitDate: "",
    autoJudge: "",
    manualJudge: "",
    finalJudge: "대상",
    judgeKind: "target" as const,
    autoNote: "",
    memo: "",
    evalItems: [ch],
    editedBy: "",
    editedAt: "",
  }));
}

function expandChannelAtoms(
  roster: DistRosterPerson[],
  teams: DistTeam[],
  aqtBase: Record<string, number>,
  t: DistTeam,
  ch: string,
  kind: "job" | "cs",
  base?: DistAssignUnit,
): DistAssignUnit[] {
  const c = effCh(t).find((x) => x.ch === ch);
  if (!c) return [];
  const be = kind === "job" ? +c.jobBe || 0 : +c.csBe || 0;
  if (be <= 0) return [];
  const mems = resolveMembers(roster, teams, t.name, ch);
  if (!mems.length) return [];
  const total = mems.length * be;
  const shares = allocTotal(
    total,
    mems.map(() => 1),
  );
  const aqt = kind === "job" ? getJobWorkAQT(t, aqtBase) : getChannelWorkAQT(t, c, aqtBase);
  const out: DistAssignUnit[] = [];
  mems.forEach((m, i) => {
    const n = shares[i] || 0;
    if (!n) return;
    out.push({
      teamName: t.name,
      ch,
      isPhone: ch.includes("전화"),
      ppl: 1,
      cs: kind === "cs" ? n : 0,
      job: kind === "job" ? n : 0,
      aqt,
      type: "member",
      kind,
      memberId: String(m.employeeId),
      memberName: m.nameEn || m.employeeId,
      repeat: base?.repeat,
    });
  });
  return out;
}

export function expandUnitToMembers(
  roster: DistRosterPerson[],
  teams: DistTeam[],
  aqtBase: Record<string, number>,
  u: DistAssignUnit,
): DistAssignUnit[] {
  if (u.type === "member" && u.memberId) return [u];
  const t = teams.find((x) => x.name === u.teamName);
  if (!t) {
    return [{ ...u, type: "member", memberId: u.memberId || "_unk", memberName: u.memberName || u.teamName }];
  }
  const kind: "job" | "cs" = u.kind === "job" ? "job" : "cs";
  if (
    u.type === "channel" ||
    (u.ch && !String(u.ch).includes("+") && effCh(t).some((c) => c.ch === u.ch))
  ) {
    return expandChannelAtoms(roster, teams, aqtBase, t, u.ch, kind, u);
  }
  const atoms: DistAssignUnit[] = [];
  for (const c of effCh(t)) {
    const be = kind === "job" ? +c.jobBe || 0 : +c.csBe || 0;
    if (be > 0) atoms.push(...expandChannelAtoms(roster, teams, aqtBase, t, c.ch, kind, u));
  }
  return atoms.length
    ? atoms
    : [{ ...u, type: "member", memberId: `_t_${t.name}`, memberName: t.name }];
}

export function expandAssignResult(
  roster: DistRosterPerson[],
  teams: DistTeam[],
  aqtBase: Record<string, number>,
  result: DistAssignResult,
): DistAssignResult {
  const out: DistAssignResult = {};
  for (const gn of Object.keys(result || {})) {
    const list: DistAssignUnit[] = [];
    for (const u of result[gn] || []) {
      if (u.kind === "job" || u.kind === "cs" || u.cs || u.job) {
        list.push(...expandUnitToMembers(roster, teams, aqtBase, u));
      }
    }
    out[gn] = list;
  }
  return out;
}

export function getLv(actual: number, opt: number): { cls: string; label: string } {
  if (!opt) return { cls: "lv1", label: "적정" };
  const p = (actual / opt) * 100;
  if (p <= 70) return { cls: "lv0", label: "여유" };
  if (p <= 100) return { cls: "lv1", label: "적정" };
  if (p <= 120) return { cls: "lv2", label: "주의" };
  if (p <= 150) return { cls: "lv3", label: "과부하" };
  return { cls: "lv4", label: "위험" };
}

export function buildGpdFromResult(
  gps: DistGp[],
  cfg: DistCfg,
  result: DistAssignResult,
): DistManHourRow[] {
  const order: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const g of gps) {
    if (!seen[g.name]) {
      seen[g.name] = true;
      order.push(g.name);
    }
  }
  for (const gn of Object.keys(result || {})) {
    if (!seen[gn]) {
      seen[gn] = true;
      order.push(gn);
    }
  }
  return order.map((gn) => {
    const g = gps.find((x) => x.name === gn) || { name: gn, cs: false, ratio: 0, avail: cfg.avail, buffer: 0, locked: false };
    let direct = 0;
    let csCount = 0;
    let workMin = 0;
    const teamsIn: Record<string, boolean> = {};
    for (const u of result[gn] || []) {
      if (u.kind === "job") direct += +u.job || 0;
      else csCount += +u.cs || 0;
      workMin += metricOf(u, "time");
      if (u.teamName) teamsIn[u.teamName] = true;
    }
    const avail = +g.avail || cfg.avail || 4;
    const buffer = +g.buffer || 0;
    const workMinBuf = workMin * (1 + buffer / 100);
    const total = direct + csCount;
    const pd = cfg.days ? total / cfg.days : 0;
    const effAqt = total ? workMinBuf / total : 10 * (1 + buffer / 100);
    const opt = effAqt ? Math.round((avail * 60) / effAqt) : 0;
    const teamNames = Object.keys(teamsIn);
    return {
      name: gn,
      teamLabel: teamNames.length ? teamNames.join(" + ") : "배정 없음",
      direct,
      csCount,
      total,
      perDay: pd,
      opt,
      aqt: Math.round((total ? workMin / total : 10) * 10) / 10,
      effAqt: Math.round(effAqt * 10) / 10,
      avail,
      buffer,
      workMin: workMinBuf,
      lv: getLv(pd, opt),
    };
  });
}

export function rosterTeamCount(roster: DistRosterPerson[], name: string): number | null {
  const m = roster.filter((p) => p.teamName === name);
  if (!m.length) return null;
  return m.filter(isTargetPerson).length;
}

export function syncTeamsFromRoster(
  teams: DistTeam[],
  roster: DistRosterPerson[],
  coldData: Record<string, { rate: number }>,
  aqtBase: Record<string, number>,
): DistTeam[] {
  if (!roster.length) return teams;
  const next = teams.map((t) => ({ ...t, channels: t.channels.map((c) => ({ ...c })) }));
  const byTeam: Record<string, DistRosterPerson[]> = {};
  for (const p of roster.filter(isTargetPerson)) {
    const k = p.teamName || "(팀 미지정)";
    (byTeam[k] ??= []).push(p);
  }
  for (const tn of Object.keys(byTeam)) {
    let t = next.find((x) => x.name === tn);
    if (!t) {
      t = {
        id: `T${String(next.length + 1).padStart(2, "0")}`,
        on: true,
        name: tn,
        gp: "",
        ppl: 0,
        cold: 0,
        csMode: "normal",
        difficulty: 1,
        channels: [],
      };
      next.push(t);
    }
    t.ppl = byTeam[tn].length;
    if (coldData[tn] !== undefined) t.cold = coldData[tn].rate;
    const items: Record<string, boolean> = {};
    for (const p of byTeam[tn]) for (const o of p.evalItems) items[o] = true;
    for (const ch of Object.keys(items)) {
      if (!t.channels.some((c) => c.ch === ch)) {
        t.channels.push({ ch, on: true, aqt: getDefAQT(ch, aqtBase), jobBe: 0, csBe: 0, note: "" });
      }
    }
    if (!t.channels.length) {
      t.channels.push({ ch: "문의", on: true, aqt: getDefAQT("문의", aqtBase), jobBe: 0, csBe: 0, note: "" });
    }
  }
  return next;
}

export function redistributeLockedRatios(gps: DistGp[], changedIndex: number, newRatio: number): DistGp[] {
  const next = gps.map((g) => ({ ...g }));
  if (!next[changedIndex]) return next;
  next[changedIndex].ratio = Math.max(0, Math.round(newRatio));
  const lkS = next.reduce((s, g, idx) => s + (g.cs && (g.locked || idx === changedIndex) ? g.ratio : 0), 0);
  const rem = Math.max(0, 100 - lkS);
  const tg = next.map((g, idx) => ({ g, idx })).filter(({ g, idx }) => g.cs && !g.locked && idx !== changedIndex);
  if (tg.length) {
    const oldS = tg.reduce((s, x) => s + x.g.ratio, 0);
    let a = 0;
    tg.forEach((x, j) => {
      if (j === tg.length - 1) x.g.ratio = Math.max(0, rem - a);
      else {
        const sh = oldS > 0 ? Math.round((x.g.ratio / oldS) * rem) : Math.floor(rem / tg.length);
        x.g.ratio = Math.max(0, sh);
        a += x.g.ratio;
      }
    });
  }
  return next;
}
