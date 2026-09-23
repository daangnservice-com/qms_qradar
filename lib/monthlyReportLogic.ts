import { parseScoreDetail } from "./scoreDetailParse";
import type {
  AgentMonth,
  ChannelBucket,
  CriterionLookup,
  ItemDrillPerson,
  MonthAgg,
  MonthlyCaseRow,
  PrimaryCounts,
  RepeatColdRow,
  TeamSplitRow,
  Temp,
  TrendPoint,
} from "./monthlyReportTypes";

export const CRITICAL_CATEGORY = "고객집착 결여(Critical)";
export const CRITICAL_ITEM_LABEL =
  "(고객집착 결여) 응대 전반에서 고객 배려 의지가 없거나 기계적 응대가 반복되어 고객 경험에 큰 영향을 끼치는 경우";

export const ITEM_CATEGORIES: Array<[string, string[]]> = [
  [
    "예절·화법",
    [
      "인사 누락",
      "상황에 맞는 필수 멘트 미사용 (배려, 화답, 사과, 쿠션어 등)",
      "고객의 이해도를 저하시키는 용어 사용 (내부 및 전문 용어 등)",
      "하나의 상담에서 3회 이상 비전문적 용어 사용 (일상어 또는 습관어 등)",
      "상황에 맞지 않은 톤앤매너 표현",
      "상담 태도 미흡 (경미한 음성 톤의 변화, 의도하지 않은 한숨 등)",
      "(언어/태도 불량) 반말, 욕설·비속어, 비아냥, 고객을 탓하는 말투, 언쟁, 의도적 한숨 등 불친절 요소",
    ],
  ],
  [
    "공감·경청",
    [
      "상황에 맞는 공감 누락 및 미흡",
      "경청 태도 미흡 (말 겹침, 중간 개입 등)",
    ],
  ],
  [
    "적극 응대",
    [
      "네/아니오 식의 단답변 또는 고객이 여러 번 되묻게 만드는 수동적 태도",
      "(해결 의지 X) 무분별한 정보를 일괄 전달하여 추측하게 만드는 경우",
      "(해결 의지 X) 충분하지 않은 안내로 문의 해결에 저하 요인 발생",
      "사측 입장에서의 안내로만 일관한 경우",
      "니즈 파악이 충분히 가능함에도 답변되지 않은 경우",
    ],
  ],
  [
    "문의 파악",
    [
      "(문의 이해 실패) 동문서답하는 경우",
      "(문의 이해 실패) 고객으로부터 니즈 확인이 정정된 경우",
      "(문의 이해 실패) 포괄적 키워드로 요약하여 문의 파악이 불명확한 경우",
      "(탐색 부족) 고객 문의가 모호함에도 추가 탐색 생략 또는 임의 판단하여 오안내한 경우",
      "불필요한 탐색이 지속되는 경우",
      "재진술이 누락된 경우",
      "(히스토리 탐색 미흡) 이미 요청한 또는 답변된 내용을 되묻는 경우",
    ],
  ],
  [
    "정확 응대",
    [
      "정책/가이드 기준에 맞지 않은 안내와 처리",
      "기준을 확인하지 않거나, 기준이 없어서 임의로 안내한 경우",
      "일부 답변 또는 업무 처리 누락",
    ],
  ],
  ["절차 준수", ["프로세스 미준수"]],
  [
    "리스크 관리",
    [
      "대외비 또는 개인정보 유출",
      "이슈 레이징없이 방치",
      "(중대 오안내) 금전·보상·정책 관련 중대 오류 안내",
      "(중대 오안내) 당근 정책과 관계없는 임의 안내",
    ],
  ],
  [
    "설명 능력",
    [
      "고객 이해도에 맞게 '설명'되지 않은 경우",
      "재인입시, 고객 이해도에 맞게 '재설명'되지 않은 경우",
      "명확한 정정 안내없이 정정이 진행된 경우",
      "(구조화 설명) 두괄식 답변 미흡",
      "(스킬 부족) 무분별한 정보를 일괄 전달하여 추측하게 만드는 경우",
      "(스킬 부족) 충분하지 않은 안내 또는 장황한 안내로 문의 해결에 저하 요인 발생",
    ],
  ],
];

export const CATEGORY_DOMAIN: Record<string, "CS" | "직무"> = {
  "공감·경청": "CS",
  "예절·화법": "CS",
  "적극 응대": "CS",
  "문의 파악": "CS",
  "정확 응대": "직무",
  "설명 능력": "직무",
  "절차 준수": "직무",
  "리스크 관리": "직무",
};

const CATEGORY_CANON: Record<string, string> = {
  "예절과 화법": "예절·화법",
  "예절·화법": "예절·화법",
  "공감과 경청": "공감·경청",
  "공감·경청": "공감·경청",
  "적극응대": "적극 응대",
  "적극 응대": "적극 응대",
  "문의파악": "문의 파악",
  "문의 파악": "문의 파악",
  "정확응대": "정확 응대",
  "정확 응대": "정확 응대",
  "설명능력": "설명 능력",
  "설명 능력": "설명 능력",
  "절차준수": "절차 준수",
  "절차 준수": "절차 준수",
  "리스크관리": "리스크 관리",
  "리스크 관리": "리스크 관리",
};

const ITEM_CATEGORY_MAP: Record<string, string> = {};
for (const [cat, its] of ITEM_CATEGORIES) {
  for (const it of its) ITEM_CATEGORY_MAP[normalizeItemKey(it)] = cat;
}
ITEM_CATEGORY_MAP[normalizeItemKey(CRITICAL_ITEM_LABEL)] = CRITICAL_CATEGORY;

export function normalizeItemKey(s: string): string {
  return (s || "").toString().trim().replace(/\s+/g, " ");
}

function compactCategory(s: string): string {
  return normalizeItemKey(s).replace(/[·\s]/g, "").replace(/과/g, "");
}

export function canonCategory(raw: string): string {
  const t = normalizeItemKey(raw);
  if (!t) return t;
  if (t.includes("고객집착 결여") || t.includes("Critical")) return CRITICAL_CATEGORY;
  if (CATEGORY_CANON[t]) return CATEGORY_CANON[t];
  const compact = compactCategory(t);
  for (const [k, v] of Object.entries(CATEGORY_CANON)) {
    if (compactCategory(k) === compact) return v;
  }
  return t;
}

export function isAuditChannel(channel: string): boolean {
  return channel.includes("심사");
}

export function normalizeChannel(templateName: string): string {
  const s = (templateName || "").trim();
  if (!s) return "미지정";
  if (s.includes("심사")) return "심사";
  if (s.includes("채팅")) return "채팅";
  if (s.includes("인앱") || s.includes("문의")) return "문의";
  if (s.includes("전화")) return "전화";
  return s;
}

export function parseTemp(raw: string): Temp | null {
  const r = (raw || "").trim().toLowerCase();
  if (!r) return null;
  if (r === "hot" || r.startsWith("h")) return "H";
  if (r === "cold" || r.startsWith("c")) return "C";
  if (r === "melt" || r.startsWith("m")) return "M";
  return null;
}

export function emptyBucket(): ChannelBucket {
  return { H: 0, C: 0, M: 0, items: {}, memos: [], targetTemp: null };
}

export function bump(bucket: ChannelBucket, temp: Temp): void {
  if (temp === "H") bucket.H += 1;
  else if (temp === "C") bucket.C += 1;
  else bucket.M += 1;
}

export function addItems(dst: Record<string, number>, src: Record<string, number>): void {
  for (const k of Object.keys(src)) dst[k] = (dst[k] || 0) + src[k];
}

export function mergeBucket(dst: ChannelBucket, src: ChannelBucket): void {
  dst.H += src.H;
  dst.C += src.C;
  dst.M += src.M;
  addItems(dst.items, src.items);
  if (src.memos.length) dst.memos.push(...src.memos);
  if (!dst.targetTemp && src.targetTemp) dst.targetTemp = src.targetTemp;
}

/** Cold 하나라도 있으면 Cold, 아니면 Hot. Melt 는 판정에서 제외. */
export function integratedStatus(channels: Record<string, Pick<ChannelBucket, "C">>): "C" | "H" {
  for (const c of Object.keys(channels)) {
    if ((channels[c]?.C || 0) > 0) return "C";
  }
  return "H";
}

export function agentMeltCount(channels: Record<string, Pick<ChannelBucket, "M">>): number {
  let n = 0;
  for (const c of Object.keys(channels)) n += channels[c]?.M || 0;
  return n;
}

function emptyMonth(ym: string): MonthAgg {
  return {
    ym,
    teams: {},
    agents: {},
    channels: {},
    items: {},
    cold: 0,
    hot: 0,
    melt: 0,
    integrated: { hot: 0, cold: 0, melt: 0 },
  };
}

export function collectViolationItems(
  scoreDetail: string,
  criteriaById: Map<number, CriterionLookup>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const parsed = parseScoreDetail(scoreDetail);
  if (parsed.length) {
    for (const it of parsed) {
      const crit = criteriaById.get(it.id);
      const label = normalizeItemKey(crit?.label || it.label);
      if (!label) continue;
      out[label] = (out[label] || 0) + 1;
    }
    return out;
  }
  for (const line of String(scoreDetail || "")
    .split(/\r?\n/)
    .map((l) => normalizeItemKey(l))
    .filter(Boolean)) {
    out[line] = (out[line] || 0) + 1;
  }
  return out;
}

export function itemCategory(itemKey: string, criteriaById?: Map<number, CriterionLookup>): string {
  const key = normalizeItemKey(itemKey);
  if (key.includes("고객집착 결여")) return CRITICAL_CATEGORY;
  const byLabel = ITEM_CATEGORY_MAP[key];
  if (byLabel) return byLabel;
  if (criteriaById) {
    for (const c of criteriaById.values()) {
      if (normalizeItemKey(c.label) === key) return canonCategory(c.category);
    }
  }
  return "미분류";
}

export function isCsAdminItems(items: Record<string, number>, criteriaById?: Map<number, CriterionLookup>): boolean {
  return Object.keys(items).some((k) => itemCategory(k, criteriaById) !== "미분류");
}

function ensureTeam(month: MonthAgg, team: string) {
  if (!month.teams[team]) month.teams[team] = { channels: {}, integrated: { hot: 0, cold: 0, melt: 0 } };
  return month.teams[team];
}

function ensureAgent(month: MonthAgg, key: string, name: string, team: string) {
  if (!month.agents[key]) month.agents[key] = { key, name, team, channels: {} };
  return month.agents[key];
}

function ensureChannel(owner: { channels: Record<string, ChannelBucket> }, ch: string) {
  if (!owner.channels[ch]) owner.channels[ch] = emptyBucket();
  return owner.channels[ch];
}

function recomputeMonth(month: MonthAgg): void {
  const channels: Record<string, ChannelBucket> = {};
  const items: Record<string, number> = {};
  for (const teamName of Object.keys(month.teams)) {
    const t = month.teams[teamName];
    t.channels = {};
    t.integrated = { hot: 0, cold: 0, melt: 0 };
  }
  for (const agent of Object.values(month.agents)) {
    const team = ensureTeam(month, agent.team);
    for (const ch of Object.keys(agent.channels)) {
      const src = agent.channels[ch];
      if (!team.channels[ch]) team.channels[ch] = emptyBucket();
      mergeBucket(team.channels[ch], src);
      if (!channels[ch]) channels[ch] = emptyBucket();
      mergeBucket(channels[ch], src);
      addItems(items, src.items);
    }
    const st = integratedStatus(agent.channels);
    if (st === "H") team.integrated.hot += 1;
    else team.integrated.cold += 1;
    if (agentMeltCount(agent.channels) > 0) team.integrated.melt += 1;
  }
  let cold = 0;
  let hot = 0;
  let melt = 0;
  for (const ch of Object.keys(channels)) {
    cold += channels[ch].C;
    hot += channels[ch].H;
    melt += channels[ch].M;
  }
  const integrated = { hot: 0, cold: 0, melt: 0 };
  for (const agent of Object.values(month.agents)) {
    const st = integratedStatus(agent.channels);
    if (st === "H") integrated.hot += 1;
    else integrated.cold += 1;
    if (agentMeltCount(agent.channels) > 0) integrated.melt += 1;
  }
  month.channels = channels;
  month.items = items;
  month.cold = cold;
  month.hot = hot;
  month.melt = melt;
  month.integrated = integrated;
}

export function buildMonthsFromCases(
  rows: MonthlyCaseRow[],
  criteria: CriterionLookup[] = [],
): Record<string, MonthAgg> {
  const criteriaById = new Map(criteria.map((c) => [c.id, c]));
  const months: Record<string, MonthAgg> = {};

  for (const row of rows) {
    const ym = row.month;
    const temp = parseTemp(row.caseResult);
    if (!ym || !temp) continue;
    const team = row.team.trim() || "미지정";
    const key = row.memberKey.trim() || row.memberLabel.trim() || "미지정";
    const name = row.memberLabel.trim() || key;
    const ch = normalizeChannel(row.templateName);
    const items = collectViolationItems(row.scoreDetail, criteriaById);
    const memo = (row.memoDetail || "").trim();
    const targetTemp = parseTemp(row.targetResult);

    if (!months[ym]) months[ym] = emptyMonth(ym);
    const m = months[ym];
    const agent = ensureAgent(m, key, name, team);
    if (!agent.name && name) agent.name = name;
    const ab = ensureChannel(agent, ch);
    bump(ab, temp);
    addItems(ab.items, items);
    if (memo) ab.memos.push(memo);
    if (targetTemp) ab.targetTemp = targetTemp;
    void ensureTeam(m, team);
  }

  for (const m of Object.values(months)) recomputeMonth(m);
  return months;
}

export function scopeMonthToTeam(m: MonthAgg | null | undefined, teamName: string): MonthAgg | null {
  if (!m) return null;
  if (!teamName || teamName === "__all__") return m;
  const teamData = m.teams[teamName];
  if (!teamData) {
    return {
      ...m,
      teams: {},
      agents: {},
      channels: {},
      items: {},
      cold: 0,
      hot: 0,
      melt: 0,
      integrated: { hot: 0, cold: 0, melt: 0 },
    };
  }
  const agents: Record<string, AgentMonth> = {};
  for (const [k, a] of Object.entries(m.agents)) {
    if (a.team === teamName) agents[k] = a;
  }
  const channels: Record<string, ChannelBucket> = {};
  const items: Record<string, number> = {};
  for (const c of Object.keys(teamData.channels)) {
    channels[c] = teamData.channels[c];
    addItems(items, teamData.channels[c].items);
  }
  let cold = 0;
  let hot = 0;
  let melt = 0;
  for (const c of Object.keys(channels)) {
    cold += channels[c].C;
    hot += channels[c].H;
    melt += channels[c].M;
  }
  return {
    ...m,
    teams: { [teamName]: teamData },
    agents,
    channels,
    items,
    cold,
    hot,
    melt,
    integrated: { ...teamData.integrated },
  };
}

export function primaryCounts(m: MonthAgg): PrimaryCounts {
  if (Object.keys(m.agents).length > 0) {
    return { ...m.integrated, basis: "통합(인원 기준)" };
  }
  return { hot: m.hot, cold: m.cold, melt: m.melt, basis: "케이스 기준" };
}

export function ratePct(n: number, total: number): number {
  return total ? (n / total) * 100 : 0;
}

export function getTeamSplitStats(m: MonthAgg, teamName: string, splitAudit = true): TeamSplitRow[] {
  const teamData = m.teams[teamName];
  if (!teamData) return [];
  const teamAgents = Object.values(m.agents).filter((a) => a.team === teamName);
  const anyAudit =
    splitAudit && teamAgents.some((a) => Object.keys(a.channels).some((c) => isAuditChannel(c)));
  if (!anyAudit) {
    const { cold, hot, melt } = teamData.integrated;
    const hasPeople = Object.keys(m.agents).length > 0;
    if (hasPeople) return [{ label: teamName, cold, hot, melt, basis: "인원" }];
    let c = 0;
    let h = 0;
    let ml = 0;
    for (const ch of Object.values(teamData.channels)) {
      c += ch.C;
      h += ch.H;
      ml += ch.M;
    }
    return [{ label: teamName, cold: c, hot: h, melt: ml, basis: "케이스" }];
  }
  const ops = { cold: 0, hot: 0, melt: 0 };
  const audit = { cold: 0, hot: 0, melt: 0 };
  for (const a of teamAgents) {
    const opsChannels: Record<string, ChannelBucket> = {};
    const auditChannels: Record<string, ChannelBucket> = {};
    for (const c of Object.keys(a.channels)) {
      if (isAuditChannel(c)) auditChannels[c] = a.channels[c];
      else opsChannels[c] = a.channels[c];
    }
    if (Object.keys(opsChannels).length > 0) {
      const st = integratedStatus(opsChannels);
      if (st === "H") ops.hot += 1;
      else ops.cold += 1;
      if (agentMeltCount(opsChannels) > 0) ops.melt += 1;
    }
    if (Object.keys(auditChannels).length > 0) {
      const st = integratedStatus(auditChannels);
      if (st === "H") audit.hot += 1;
      else audit.cold += 1;
      if (agentMeltCount(auditChannels) > 0) audit.melt += 1;
    }
  }
  const result: TeamSplitRow[] = [];
  if (ops.cold + ops.hot + ops.melt > 0) result.push({ label: `${teamName}<운영>`, ...ops, basis: "인원" });
  if (audit.cold + audit.hot + audit.melt > 0) result.push({ label: `${teamName}<심사>`, ...audit, basis: "인원" });
  return result;
}

export function categoryTotals(
  items: Record<string, number>,
  criteriaById?: Map<number, CriterionLookup>,
): Record<string, number> {
  const catTotals: Record<string, number> = {};
  for (const [cat] of ITEM_CATEGORIES) catTotals[cat] = 0;
  for (const k of Object.keys(items)) {
    const cat = itemCategory(k, criteriaById);
    if (cat === CRITICAL_CATEGORY) {
      catTotals[CRITICAL_CATEGORY] = (catTotals[CRITICAL_CATEGORY] || 0) + items[k];
      continue;
    }
    if (cat === "미분류") continue;
    catTotals[cat] = (catTotals[cat] || 0) + items[k];
  }
  return catTotals;
}

export function buildTrend(months: MonthAgg[]): TrendPoint[] {
  return months.map((m) => {
    const pc = primaryCounts(m);
    const total = pc.hot + pc.cold + pc.melt;
    const channels: TrendPoint["channels"] = {};
    for (const [c, b] of Object.entries(m.channels)) {
      channels[c] = { H: b.H, C: b.C, M: b.M };
    }
    return {
      month: m.ym,
      hot: pc.hot,
      cold: pc.cold,
      melt: pc.melt,
      total,
      hotRate: ratePct(pc.hot, total),
      channels,
    };
  });
}

export function buildRepeatCold(months: MonthAgg[], topN = 10): RepeatColdRow[] {
  const byPerson = new Map<string, RepeatColdRow>();
  for (const m of months) {
    for (const a of Object.values(m.agents)) {
      let H = 0;
      let C = 0;
      let M = 0;
      for (const b of Object.values(a.channels)) {
        H += b.H;
        C += b.C;
        M += b.M;
      }
      if (C <= 0 && M <= 0 && H <= 0) continue;
      let row = byPerson.get(a.key);
      if (!row) {
        row = { key: a.key, name: a.name, team: a.team, totalCold: 0, byMonth: [] };
        byPerson.set(a.key, row);
      }
      row.totalCold += C;
      row.byMonth.push({ month: m.ym, H, C, M });
    }
  }
  return [...byPerson.values()]
    .filter((r) => r.totalCold >= 2)
    .sort((a, b) => b.totalCold - a.totalCold || a.name.localeCompare(b.name, "ko"))
    .slice(0, topN);
}

export function itemDrilldown(
  m: MonthAgg,
  label: string,
  categoryMode: boolean,
  criteriaById?: Map<number, CriterionLookup>,
): ItemDrillPerson[] {
  const rows: ItemDrillPerson[] = [];
  for (const a of Object.values(m.agents)) {
    for (const [ch, b] of Object.entries(a.channels)) {
      for (const [k, n] of Object.entries(b.items)) {
        if (n <= 0) continue;
        const cat = itemCategory(k, criteriaById);
        const match = categoryMode
          ? cat === label || (label === CRITICAL_CATEGORY && cat === CRITICAL_CATEGORY)
          : k === label;
        if (!match) continue;
        rows.push({ name: a.name, team: a.team, channel: ch, item: k, count: n });
      }
    }
  }
  return rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

export function categoryKeywordVariants(cat: string): string[] {
  const noDot = cat.replace(/·/g, "");
  const noSpace = cat.replace(/\s+/g, "");
  const noDotNoSpace = cat.replace(/[·\s]/g, "");
  return Array.from(new Set([cat, noDot, noSpace, noDotNoSpace].filter(Boolean)));
}

export type AgentPattern =
  | { type: "양호"; text: string }
  | { type: "채널Cold"; text: string; channel: string }
  | { type: "복수채널Cold"; text: string }
  | { type: "신규Cold"; text: string }
  | { type: "연속Cold"; text: string; n: number }
  | { type: "급격악화"; text: string }
  | { type: "개선"; text: string };

export function getAgentStreak(
  monthsAsc: MonthAgg[],
  agentKey: string,
  ym: string,
): number {
  const globalIdx = monthsAsc.findIndex((mm) => mm.ym === ym);
  if (globalIdx < 0) return 0;
  let streak = 0;
  for (let i = globalIdx; i >= 0; i--) {
    const ad = monthsAsc[i].agents[agentKey];
    if (!ad) break;
    if (integratedStatus(ad.channels) !== "H") streak += 1;
    else break;
  }
  return streak;
}

export function classifyAgentPatterns(monthsAsc: MonthAgg[], agentKey: string, ym: string): AgentPattern[] {
  const globalIdx = monthsAsc.findIndex((mm) => mm.ym === ym);
  if (globalIdx < 0) return [];
  const m = monthsAsc[globalIdx];
  const agentData = m.agents[agentKey];
  if (!agentData) return [];
  const cur = integratedStatus(agentData.channels);
  const labels: AgentPattern[] = [];
  const chanStatus: Record<string, Temp> = {};
  for (const c of Object.keys(agentData.channels)) {
    const b = agentData.channels[c];
    chanStatus[c] = b.M > 0 ? "M" : b.C > 0 ? "C" : "H";
  }
  const coldChannels = Object.keys(chanStatus).filter((c) => chanStatus[c] !== "H");
  if (cur === "H") labels.push({ type: "양호", text: "양호" });
  for (const c of coldChannels) labels.push({ type: "채널Cold", text: `${c} Cold`, channel: c });
  if (coldChannels.length >= 2) labels.push({ type: "복수채널Cold", text: "복수채널 Cold — 복합 집중 관리 필요" });

  const firstAppearIdx = monthsAsc.findIndex((mm) => mm.agents[agentKey]);
  if (firstAppearIdx === globalIdx && cur !== "H") {
    labels.push({ type: "신규Cold", text: "신규 Cold — 조기 개입 필요" });
  }
  const streak = getAgentStreak(monthsAsc, agentKey, ym);
  if (streak >= 3) {
    labels.push({ type: "연속Cold", text: `연속 Cold(${streak}개월) — 코칭 이력 점검 필요`, n: streak });
  }
  if (globalIdx > 0) {
    const prevAd = monthsAsc[globalIdx - 1].agents[agentKey];
    if (prevAd) {
      const prevSt = integratedStatus(prevAd.channels);
      if (prevSt === "H" && cur !== "H") {
        labels.push({ type: "급격악화", text: "급격 악화(전월 Hot→이번달 Cold) — 원인 파악 필요" });
      }
      if (prevSt !== "H" && cur === "H") {
        labels.push({ type: "개선", text: "개선(전월 Cold→이번달 Hot)" });
      }
    }
  }
  return labels;
}

export function consistencyFlag(agent: AgentMonth): { caseSt: "C" | "H"; targetSt: "C" | "H" } | null {
  let targetTemp: Temp | null = null;
  for (const b of Object.values(agent.channels)) {
    if (b.targetTemp) targetTemp = b.targetTemp;
  }
  if (!targetTemp) return null;
  const caseSt = integratedStatus(agent.channels);
  const targetSt: "C" | "H" = targetTemp === "C" ? "C" : "H";
  if (caseSt !== targetSt) return { caseSt, targetSt };
  return null;
}

export function patternMonthsOf(months: MonthAgg[]): Array<{
  ym: string;
  agents: Record<string, { name: string; team: string; channels: Record<string, { H: number; C: number; M: number }> }>;
}> {
  return months.map((m) => {
    const agents: Record<string, { name: string; team: string; channels: Record<string, { H: number; C: number; M: number }> }> =
      {};
    for (const [k, a] of Object.entries(m.agents)) {
      const channels: Record<string, { H: number; C: number; M: number }> = {};
      for (const [c, b] of Object.entries(a.channels)) channels[c] = { H: b.H, C: b.C, M: b.M };
      agents[k] = { name: a.name, team: a.team, channels };
    }
    return { ym: m.ym, agents };
  });
}
