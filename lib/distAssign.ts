/** 배분 알고리즘 — GAS index.html `runAssign` 이식. */

import type {
  DistAssignMetric,
  DistAssignResult,
  DistAssignRun,
  DistAssignScope,
  DistAssignUnit,
  DistGp,
  DistHistoryRow,
  DistRosterPerson,
  DistTeam,
} from "./distTypes";
import {
  buildJobUnits,
  expandAssignResult,
  getCS,
  getChLabel,
  getChannelCsTotal,
  getChannelWorkAQT,
  getTeamWorkAQT,
  hasMultipleCsChannels,
  hasPhone,
  isRegularCS,
  metricOf,
  teamHasWorkload,
  effCh,
} from "./distWorkload";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = r[i];
    r[i] = r[j];
    r[j] = t;
  }
  return r;
}

export type RunAssignInput = {
  month: string;
  teams: DistTeam[];
  gps: DistGp[];
  roster: DistRosterPerson[];
  aqtBase: Record<string, number>;
  history: DistHistoryRow[];
  metric?: DistAssignMetric;
  scope?: DistAssignScope;
  rng?: Rng;
  attempts?: number;
};

export type RunAssignOk = { ok: true; run: DistAssignRun };
export type RunAssignErr = { ok: false; error: string };
export type RunAssignOutput = RunAssignOk | RunAssignErr;

export function runAssign(input: RunAssignInput): RunAssignOutput {
  const metric: DistAssignMetric = input.metric ?? "count";
  const scope: DistAssignScope = input.scope ?? "cs";
  const rng = input.rng ?? Math.random;
  const attempts = input.attempts ?? 1200;
  const { teams, gps, roster, aqtBase, history, month } = input;

  const cgps = gps.filter((g) => g.cs && g.ratio > 0);
  const tR = cgps.reduce((s, g) => s + g.ratio, 0);
  if (tR !== 100) {
    return { ok: false, error: `CS 배분 비율 합계가 100%가 아니에요. (현재: ${tR}%)` };
  }

  const cst = teams.filter((t) => teamHasWorkload(roster, teams, t) && isRegularCS(t) && getCS(roster, teams, t) > 0);
  if (!cst.length) return { ok: false, error: "CS 평가 대상 팀이 없어요." };

  const tCS = cst.reduce((s, t) => s + getCS(roster, teams, t), 0);
  const jobUnits = buildJobUnits(roster, teams, aqtBase);
  const uw = (u: DistAssignUnit) => metricOf(u, metric);

  const prevMap: Record<string, Record<string, boolean>> = {};
  let prevMonth: string | null = null;
  const prevHist = history.filter((h) => h.evalMonth !== month);
  if (prevHist.length) {
    const pe = prevHist[prevHist.length - 1];
    prevMonth = pe.evalMonth || null;
    for (const gn of Object.keys(pe.result || {})) {
      for (const u of pe.result[gn] || []) {
        if (u.kind === "job") continue;
        if (!prevMap[u.teamName]) prevMap[u.teamName] = {};
        prevMap[u.teamName][gn] = true;
      }
    }
  }
  const isRepeat = (gn: string, tn: string) => !!(prevMap[tn] && prevMap[tn][gn]);

  let csPool = 0;
  for (const t of cst) {
    csPool += uw({
      kind: "cs",
      cs: getCS(roster, teams, t),
      aqt: getTeamWorkAQT(t, aqtBase),
      teamName: t.name,
      ch: "",
      isPhone: false,
      ppl: 0,
      job: 0,
      type: "team",
    });
  }
  const jobFixed: Record<string, number> = {};
  cgps.forEach((g) => {
    jobFixed[g.name] = 0;
  });
  let jobPoolOnCgps = 0;
  for (const u of jobUnits) {
    const t = teams.find((x) => x.name === u.teamName);
    const gn = t?.gp;
    if (gn && jobFixed[gn] != null) {
      jobFixed[gn] += uw(u);
      jobPoolOnCgps += uw(u);
    }
  }
  const pool = scope === "total" ? csPool + jobPoolOnCgps : csPool;

  const gpTgt: Record<string, number> = {};
  const gpMin: Record<string, number> = {};
  const gpMax: Record<string, number> = {};
  let asn = 0;
  cgps.forEach((g, gi) => {
    const share = (pool * g.ratio) / 100;
    const fixed = scope === "total" ? jobFixed[g.name] || 0 : 0;
    const csTgt = Math.max(0, share - fixed);
    const tgt = gi === cgps.length - 1 ? Math.max(0, csPool - asn) : Math.round(csTgt);
    gpTgt[g.name] = tgt;
    asn += tgt;
    const lo = (pool * Math.max(0, g.ratio - 5)) / 100;
    const hi = (pool * (g.ratio + 5)) / 100;
    if (scope === "total") {
      gpMin[g.name] = Math.max(0, Math.ceil(lo - fixed));
      gpMax[g.name] = Math.max(gpMin[g.name], Math.floor(hi - fixed));
    } else {
      gpMin[g.name] = Math.ceil(lo);
      gpMax[g.name] = Math.floor(hi);
    }
  });

  const tUnit = (t: DistTeam): DistAssignUnit => ({
    teamName: t.name,
    ch: getChLabel(t),
    isPhone: hasPhone(t),
    ppl: t.ppl,
    cs: getCS(roster, teams, t),
    job: 0,
    aqt: getTeamWorkAQT(t, aqtBase),
    type: "team",
    kind: "cs",
  });

  const cUnits = (t: DistTeam): DistAssignUnit[] => {
    const split = hasMultipleCsChannels(t);
    return shuffle(
      effCh(t)
        .filter((c) => c.csBe > 0)
        .map((c) => ({
          teamName: t.name,
          ch: c.ch,
          isPhone: c.ch.includes("전화"),
          ppl: roster.filter((p) => p.teamName === t.name && p.judgeKind === "target" && p.evalItems.includes(c.ch))
            .length || t.ppl,
          cs: getChannelCsTotal(roster, teams, t, c),
          job: 0,
          aqt: getChannelWorkAQT(t, c, aqtBase),
          type: (split ? "channel" : "team") as "channel" | "team",
          kind: "cs" as const,
        })),
      rng,
    );
  };

  type State = {
    load: Record<string, number>;
    phone: Record<string, number>;
    result: DistAssignResult;
    splitTeams: Record<string, boolean>;
    splitCount: number;
    maxSplitTeams: number;
  };

  const emptyState = (): State => {
    const s: State = { load: {}, phone: {}, result: {}, splitTeams: {}, splitCount: 0, maxSplitTeams: 2 };
    const names: Record<string, number> = {};
    cgps.forEach((g) => {
      names[g.name] = 1;
    });
    jobUnits.forEach((u) => {
      const t = teams.find((x) => x.name === u.teamName);
      if (t?.gp) names[t.gp] = 1;
    });
    Object.keys(names).forEach((gn) => {
      s.load[gn] = 0;
      s.phone[gn] = 0;
      s.result[gn] = [];
    });
    jobUnits.forEach((u) => {
      const t = teams.find((x) => x.name === u.teamName);
      const gn = (t && t.gp) || Object.keys(names)[0];
      if (!s.result[gn]) {
        s.result[gn] = [];
        s.load[gn] = 0;
        s.phone[gn] = 0;
      }
      s.result[gn].push(u);
    });
    cgps.forEach((g) => {
      s.load[g.name] = 0;
      s.phone[g.name] = 0;
    });
    return s;
  };

  const fitMax = (s: State, g: DistGp, u: DistAssignUnit) => s.load[g.name] + uw(u) <= gpMax[g.name];
  const countRepeats = (s: State) => {
    let n = 0;
    cgps.forEach((g) => {
      (s.result[g.name] || []).forEach((u) => {
        if (u.kind === "job") return;
        if (isRepeat(g.name, u.teamName)) n++;
      });
    });
    return n;
  };
  const scoreState = (s: State) => {
    let sc = 0;
    cgps.forEach((g) => {
      const l = s.load[g.name];
      if (l < gpMin[g.name]) sc += (gpMin[g.name] - l) * 10;
      if (l > gpMax[g.name]) sc += (l - gpMax[g.name]) * 20;
      sc += Math.abs(l - gpTgt[g.name]) * 0.1;
    });
    return sc + countRepeats(s) * 40;
  };
  const isValid = (s: State) => cgps.every((g) => s.load[g.name] >= gpMin[g.name] && s.load[g.name] <= gpMax[g.name]);

  const pickGP = (s: State, poolIn: DistGp[], u: DistAssignUnit): string | null => {
    let pool = poolIn;
    if (!pool.length) return null;
    const fresh = pool.filter((g) => !isRepeat(g.name, u.teamName));
    if (fresh.length) pool = fresh;
    if (u.isPhone) {
      const np = pool.filter((g) => s.phone[g.name] === 0);
      if (np.length) pool = np;
    }
    const ws = pool.map((g) => {
      const l = s.load[g.name];
      return Math.max(1, Math.max(0, gpMin[g.name] - l) * 80 + Math.max(0, gpTgt[g.name] - l) * 10 + Math.max(0, gpMax[g.name] - l));
    });
    let r = rng() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= ws[i];
      if (r <= 0) return pool[i].name;
    }
    return pool[pool.length - 1].name;
  };

  const assignTo = (s: State, u: DistAssignUnit, gn: string) => {
    s.result[gn].push(u);
    if (u.kind !== "job") {
      s.load[gn] += uw(u);
      if (u.isPhone) s.phone[gn]++;
    }
  };

  const assignUnit = (s: State, u: DistAssignUnit) => {
    const pool = cgps.filter((g) => fitMax(s, g, u));
    if (pool.length) {
      const gn = pickGP(s, pool, u);
      if (gn) assignTo(s, u, gn);
      return;
    }
    const fb = cgps.slice().sort((a, b) => {
      const ao = s.load[a.name] + uw(u) - gpMax[a.name];
      const bo = s.load[b.name] + uw(u) - gpMax[b.name];
      return ao !== bo ? ao - bo : s.load[a.name] - s.load[b.name];
    });
    assignTo(s, u, fb[0].name);
  };

  const splitChance = (t: DistTeam, force: boolean) => {
    if (!hasMultipleCsChannels(t)) return 0;
    let p = 0.1;
    if (getCS(roster, teams, t) >= 30) p += 0.25;
    if (hasPhone(t)) p += 0.15;
    if (effCh(t).filter((c) => c.csBe > 0).length >= 3) p += 0.1;
    if (force) p += 0.35;
    return Math.min(0.85, p);
  };

  const tryAssign = (force: boolean): State => {
    const s = emptyState();
    const phoneFirst = shuffle(cst.filter(hasPhone), rng).concat(shuffle(cst.filter((t) => !hasPhone(t)), rng));
    phoneFirst.forEach((t) => {
      const whole = tUnit(t);
      const wp = cgps.filter((g) => fitMax(s, g, whole));
      const canSplit = hasMultipleCsChannels(t) && s.splitCount < s.maxSplitTeams;
      const doSplit = canSplit && rng() < splitChance(t, force);
      if (!doSplit && wp.length) {
        const gn = pickGP(s, wp, whole);
        if (gn) assignTo(s, whole, gn);
      } else if (canSplit) {
        s.splitTeams[t.name] = true;
        s.splitCount++;
        cUnits(t).forEach((cu) => assignUnit(s, cu));
      } else {
        assignUnit(s, whole);
      }
    });
    return s;
  };

  let best: State | null = null;
  let bestScore = Infinity;
  let valid: State | null = null;
  let validScore = Infinity;
  for (let at = 0; at < attempts; at++) {
    const st = tryAssign(at > 500);
    const sc = scoreState(st);
    if (sc < bestScore) {
      bestScore = sc;
      best = st;
    }
    if (isValid(st)) {
      if (sc < validScore) {
        validScore = sc;
        valid = st;
      }
      if (countRepeats(st) === 0) break;
    }
  }
  const chosen = valid || best;
  if (!chosen) return { ok: false, error: "배분 조합을 만들지 못했어요." };

  Object.keys(chosen.result).forEach((gn) => {
    chosen.result[gn].forEach((u) => {
      if (u.kind !== "job") u.repeat = isRepeat(gn, u.teamName);
    });
  });
  const expanded = expandAssignResult(roster, teams, aqtBase, chosen.result);

  const loads: Record<string, number> = {};
  cgps.forEach((g) => {
    loads[g.name] = 0;
  });
  let poolOut = 0;
  let tCsOut = 0;
  Object.keys(expanded).forEach((gn) => {
    (expanded[gn] || []).forEach((u) => {
      const w = metricOf(u, metric);
      if (u.kind === "job") {
        if (scope === "total" && loads[gn] != null) {
          loads[gn] += w;
          poolOut += w;
        }
      } else {
        tCsOut += +u.cs || 0;
        if (loads[gn] != null) loads[gn] += w;
        poolOut += w;
      }
    });
  });

  const withinRange = cgps.every((g) => {
    const pct = poolOut ? (loads[g.name] / poolOut) * 100 : 0;
    return Math.abs(pct - g.ratio) <= 5;
  });

  const run: DistAssignRun = {
    result: expanded,
    cgps,
    tCS: tCsOut || tCS,
    month,
    runAt: new Date().toISOString(),
    withinRange: !!valid || withinRange,
    splitTeams: chosen.splitTeams || {},
    maxSplitTeams: chosen.maxSplitTeams || 2,
    repeats: countRepeats(chosen),
    prevMonth,
    confirmed: false,
    metric,
    scope,
    manual: false,
    pool: poolOut || pool,
    loads,
  };
  return { ok: true, run };
}

export type DistDragPayload = {
  fromGp: string;
  level: "team" | "channel" | "member";
  kind?: "cs" | "job";
  teamName: string;
  ch?: string;
  memberId?: string;
};

export function unitMatchesDrag(u: DistAssignUnit, payload: DistDragPayload): boolean {
  if (u.teamName !== payload.teamName) return false;
  if (payload.kind && u.kind !== payload.kind) return false;
  if (payload.level === "team") return true;
  if ((u.ch || "") !== (payload.ch || "")) return false;
  if (payload.level === "channel") return true;
  return String(u.memberId || "") === String(payload.memberId || "");
}

export function moveUnits(
  result: DistAssignResult,
  fromGp: string,
  toGp: string,
  pred: (u: DistAssignUnit) => boolean,
): DistAssignResult {
  const next: DistAssignResult = {};
  for (const gn of Object.keys(result)) next[gn] = (result[gn] || []).slice();
  const moving = (next[fromGp] || []).filter(pred);
  next[fromGp] = (next[fromGp] || []).filter((u) => !pred(u));
  next[toGp] = [...(next[toGp] || []), ...moving];
  return next;
}

export function moveByDrag(result: DistAssignResult, payload: DistDragPayload, toGp: string): DistAssignResult {
  if (!payload.fromGp || payload.fromGp === toGp) return result;
  return moveUnits(result, payload.fromGp, toGp, (u) => unitMatchesDrag(u, payload));
}

export function visibleAssignUnits(units: DistAssignUnit[] | undefined): DistAssignUnit[] {
  return (units || []).filter((u) => ((u.kind === "job" ? +u.job : +u.cs) || 0) > 0);
}

export function sumUnitsMetric(list: DistAssignUnit[], metric: DistAssignMetric): number {
  return list.reduce((s, u) => s + metricOf(u, metric), 0);
}

export function uniqueMemberCount(list: DistAssignUnit[]): number {
  const seen: Record<string, true> = {};
  for (const u of list) {
    const id = u.memberId != null && u.memberId !== "" ? String(u.memberId) : u.memberName || "";
    if (id) seen[id] = true;
  }
  return Object.keys(seen).length;
}

export type DistGpShare = { jobW: number; csW: number; totW: number };

export function gpMetricShares(result: DistAssignResult, metric: DistAssignMetric): {
  byGp: Record<string, DistGpShare>;
  grand: number;
} {
  const byGp: Record<string, DistGpShare> = {};
  let grand = 0;
  for (const gn of Object.keys(result || {})) {
    let jobW = 0;
    let csW = 0;
    for (const u of result[gn] || []) {
      const w = metricOf(u, metric);
      if (u.kind === "job") jobW += w;
      else csW += w;
    }
    byGp[gn] = { jobW, csW, totW: jobW + csW };
    grand += jobW + csW;
  }
  return { byGp, grand };
}

export function recomputeAssignStats(run: DistAssignRun): DistAssignRun {
  const metric = run.metric || "count";
  const scope = run.scope || "cs";
  const cgps = run.cgps || [];
  const loads: Record<string, number> = {};
  for (const g of cgps) loads[g.name] = 0;
  let pool = 0;
  let tCS = 0;
  for (const gn of Object.keys(run.result || {})) {
    for (const u of run.result[gn] || []) {
      const w = metricOf(u, metric);
      if (u.kind === "job") {
        if (scope === "total" && loads[gn] != null) {
          loads[gn] += w;
          pool += w;
        }
      } else {
        tCS += +u.cs || 0;
        if (loads[gn] != null) loads[gn] += w;
        pool += w;
      }
    }
  }
  const withinRange = cgps.every((g) => {
    const pct = pool ? (loads[g.name] / pool) * 100 : 0;
    return Math.abs(pct - g.ratio) <= 5;
  });
  return { ...run, pool, loads, tCS, withinRange };
}

export function latestHistoryForMonth(history: DistHistoryRow[], month: string): DistHistoryRow | null {
  const list = history.filter((h) => h.evalMonth === month && h.result && Object.keys(h.result).length);
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const idA = a.historyId || "";
    const idB = b.historyId || "";
    if (idA !== idB) return idA.localeCompare(idB);
    return (a.confirmedAt || "").localeCompare(b.confirmedAt || "");
  }).at(-1)!;
}

export function runFromHistory(h: DistHistoryRow, gps: DistGp[]): DistAssignRun {
  return recomputeAssignStats({
    result: h.result || {},
    cgps: gps.filter((g) => g.cs && g.ratio > 0),
    tCS: h.totalCs,
    month: h.evalMonth,
    runAt: h.confirmedAt,
    withinRange: h.withinPm5,
    splitTeams: {},
    maxSplitTeams: 2,
    repeats: h.repeats,
    prevMonth: null,
    confirmed: true,
    metric: h.metric || "count",
    scope: h.scope || "cs",
    manual: false,
    pool: 0,
    loads: {},
  });
}
