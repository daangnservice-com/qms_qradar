import {
  CATEGORY_DOMAIN,
  CRITICAL_CATEGORY,
  ITEM_CATEGORIES,
  categoryKeywordVariants,
  classifyAgentPatterns,
  consistencyFlag,
  integratedStatus,
  isCsAdminItems,
  itemCategory,
  primaryCounts,
  ratePct,
} from "./monthlyReportLogic";
import type { AgentMonth, MonthAgg } from "./monthlyReportTypes";

function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  let s = "| " + headers.join(" | ") + " |\n";
  s += "|" + headers.map(() => "---").join("|") + "|\n";
  for (const r of rows) s += "| " + r.join(" | ") + " |\n";
  return s;
}

function rateDeltaSuffix(curRate: number, prevRate: number | null): string {
  if (prevRate == null) return "";
  const d = curRate - prevRate;
  if (Math.abs(d) < 0.05) return " (전월대비 -)";
  const arrow = d > 0 ? "▲" : "▼";
  return ` (전월대비 ${arrow}${Math.abs(d).toFixed(1)}%p)`;
}

function critCount(m: MonthAgg): number {
  let n = 0;
  for (const [k, v] of Object.entries(m.items)) {
    if (itemCategory(k) === CRITICAL_CATEGORY) n += v;
  }
  return n;
}

function buildCriticalBadge(m: MonthAgg): string {
  if (!isCsAdminItems(m.items)) return "";
  const criticalCount = critCount(m);
  if (criticalCount <= 0) return "";
  const criticalAgents: string[] = [];
  for (const a of Object.values(m.agents)) {
    let hit = false;
    for (const ch of Object.values(a.channels)) {
      for (const k of Object.keys(ch.items)) {
        if (itemCategory(k) === CRITICAL_CATEGORY && ch.items[k] > 0) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) criticalAgents.push(a.name);
  }
  return `> 🚨 **Critical Cold** — 고객집착 결여 ${criticalCount}건 발생${criticalAgents.length ? ` (${criticalAgents.join(", ")})` : ""}. 다른 항목과 무관하게 별도 관리 필요.\n\n`;
}

function buildTopSummary(
  m: MonthAgg,
  pc: { hot: number; cold: number; melt: number },
  total: number,
  hotRate: string,
  deltaLine: string,
): string {
  const unit = Object.keys(m.agents).length > 0 ? "명" : "건";
  const lines: string[] = [];
  lines.push(`- 평가 ${unit === "명" ? "인원" : "건수"}: **${total}${unit}**`);
  lines.push(`- Hot 비중: **${hotRate}%** → ${deltaLine}`);

  if (Object.keys(m.items).length > 0) {
    if (isCsAdminItems(m.items)) {
      const catTotals: Record<string, number> = {};
      for (const [cat] of ITEM_CATEGORIES) catTotals[cat] = 0;
      for (const k of Object.keys(m.items)) {
        const cat = itemCategory(k);
        if (cat === CRITICAL_CATEGORY || cat === "미분류") continue;
        catTotals[cat] = (catTotals[cat] || 0) + m.items[k];
      }
      const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
      if (topCat && topCat[1] > 0) lines.push(`- 가장 많이 발생한 영역: **${topCat[0]}** (${topCat[1]}건)`);
    } else {
      const topItem = Object.entries(m.items).sort((a, b) => b[1] - a[1])[0];
      if (topItem && topItem[1] > 0) lines.push(`- 가장 많이 발생한 항목: **${topItem[0]}** (${topItem[1]}건)`);
    }
  }

  if (Object.keys(m.agents).length > 0) {
    let topAgent: string | null = null;
    let topCount = 0;
    for (const a of Object.values(m.agents)) {
      let cnt = 0;
      for (const ch of Object.values(a.channels)) {
        for (const n of Object.values(ch.items)) cnt += n;
      }
      if (cnt > topCount) {
        topCount = cnt;
        topAgent = a.name;
      }
    }
    if (topAgent) lines.push(`- 위반 항목이 가장 많은 인원: **${topAgent}** (${topCount}건)`);
  }

  if (!lines.length) return "";
  return `**이달의 요약**\n\n${lines.join("\n")}\n\n`;
}

function buildRosterChangeCaption(m: MonthAgg, prev: MonthAgg | null): string {
  if (!prev || !Object.keys(m.agents).length || !Object.keys(prev.agents).length) return "";
  const curNames = Object.values(m.agents).map((a) => a.name);
  const prevNames = Object.values(prev.agents).map((a) => a.name);
  const prevSet = new Set(Object.keys(prev.agents));
  const curSet = new Set(Object.keys(m.agents));
  const newKeys = Object.keys(m.agents).filter((k) => !prevSet.has(k));
  const leftKeys = Object.keys(prev.agents).filter((k) => !curSet.has(k));
  if (!newKeys.length && !leftKeys.length) return "";
  const newNames = newKeys.map((k) => m.agents[k].name);
  const leftNames = leftKeys.map((k) => prev.agents[k].name);
  void curNames;
  void prevNames;
  return `> ℹ️ 전월 대비 신규 평가: ${newNames.length ? newNames.join(", ") : "없음"} · 미평가/이탈 추정: ${leftNames.length ? leftNames.join(", ") : "없음"} — 명단 변화가 Cold율에 기계적 영향을 줄 수 있어요 [정확한 사유(퇴사/미배치 등) 미확인]\n\n`;
}

function buildAgentSummarySection(m: MonthAgg, monthsAsc: MonthAgg[]): string {
  const keys = Object.keys(m.agents).sort((a, b) => m.agents[a].name.localeCompare(m.agents[b].name, "ko"));
  if (!keys.length) return "";
  const chanColdMap: Record<string, string[]> = {};
  const good: string[] = [];
  const multiChan: string[] = [];
  const newCold: string[] = [];
  const streakCold: string[] = [];
  const worsened: string[] = [];
  const improved: string[] = [];
  for (const key of keys) {
    const name = m.agents[key].name;
    for (const l of classifyAgentPatterns(monthsAsc, key, m.ym)) {
      if (l.type === "양호") good.push(name);
      else if (l.type === "채널Cold") (chanColdMap[l.channel] ||= []).push(name);
      else if (l.type === "복수채널Cold") multiChan.push(name);
      else if (l.type === "신규Cold") newCold.push(name);
      else if (l.type === "연속Cold") streakCold.push(`${name}(${l.n}개월)`);
      else if (l.type === "급격악화") worsened.push(name);
      else if (l.type === "개선") improved.push(name);
    }
  }
  const entries: string[] = [];
  if (good.length) entries.push(`양호: ${good.join(", ")}`);
  for (const c of Object.keys(chanColdMap)) entries.push(`${c} Cold: ${chanColdMap[c].join(", ")}`);
  if (multiChan.length) entries.push(`복수채널 Cold: ${multiChan.join(", ")} — 복합 집중 관리 필요`);
  if (newCold.length) entries.push(`신규 Cold: ${newCold.join(", ")} — 조기 개입 필요`);
  if (streakCold.length) entries.push(`연속 Cold: ${streakCold.join(", ")} — 코칭 이력 점검 필요`);
  if (worsened.length) entries.push(`급격 악화: ${worsened.join(", ")} — 원인 파악 필요`);
  if (improved.length) entries.push(`개선: ${improved.join(", ")}`);
  if (!entries.length) return "";
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const lines = entries.map((e, i) => `${circled[i] || `${i + 1}.`} ${e}`);
  return "**인원별 핵심 요약**\n\n" + lines.join("\n") + "\n\n";
}

function buildRepeatColdSection(m: MonthAgg): string {
  const rows: Array<[string, number]> = [];
  for (const a of Object.values(m.agents)) {
    let coldCases = 0;
    for (const b of Object.values(a.channels)) coldCases += b.C;
    if (coldCases < 2) continue;
    rows.push([a.name, coldCases]);
  }
  if (!rows.length) return "";
  rows.sort((a, b) => b[1] - a[1]);
  let out = `**인원별 반복 Cold 집계** (이번 달 기준, Cold 케이스 2건 이상)\n\n`;
  out += mdTable(
    ["이름", "이번 달 Cold 건수"],
    rows.map((r) => [r[0], `${r[1]}건`]),
  ) + "\n";
  out += `> 이번 달 한 달 안에서 여러 채널·여러 건이 Cold였던 경우예요(다른 달은 포함 안 됨, Melt는 별도 지표라 안 섞여요). 여러 달에 걸친 누적은 대시보드 탭 "인원별 누적 Cold 횟수" 그래프에서 확인하세요.\n\n`;
  return out;
}

function buildCategoryChannelMatrix(m: MonthAgg): string {
  const channels = Object.keys(m.channels);
  if (channels.length < 2 || !Object.keys(m.agents).length) return "";
  const matrix: Record<string, Record<string, number>> = {};
  for (const [cat] of ITEM_CATEGORIES) matrix[cat] = {};
  for (const a of Object.values(m.agents)) {
    for (const [c, b] of Object.entries(a.channels)) {
      for (const [k, n] of Object.entries(b.items)) {
        const cat = itemCategory(k);
        if (cat === CRITICAL_CATEGORY || cat === "미분류") continue;
        matrix[cat][c] = (matrix[cat][c] || 0) + n;
      }
    }
  }
  const rows: Array<Array<string | number>> = [];
  for (const [cat] of ITEM_CATEGORIES) {
    const perChan = channels.map((c) => matrix[cat][c] || 0);
    const total = perChan.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    let maxIdx = -1;
    let maxVal = 0;
    perChan.forEach((v, i) => {
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    });
    const totalCell = maxIdx >= 0 ? `${total} (⚠${channels[maxIdx]} 집중)` : `${total}`;
    rows.push([cat, ...perChan, totalCell]);
  }
  if (!rows.length) return "";
  let out = `### 채널별 항목 집중도\n\n`;
  out += mdTable(["대분류", ...channels, "합계"], rows) + "\n";
  out += `> ⚠ 표시는 해당 대분류에서 다른 채널 대비 건수가 가장 많은 채널이에요(상대 비교 참고용).\n\n`;
  return out;
}

function buildItemSection(m: MonthAgg): string {
  if (!Object.keys(m.items).length) return "";
  let out = `## 3. 항목별 위반 현황\n\n`;
  if (!isCsAdminItems(m.items)) {
    const itemRows = Object.entries(m.items)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, v] as [string, number]);
    out += mdTable(
      ["항목", "건수"],
      itemRows.map(([k, v]) => [k, v]),
    ) + "\n";
    const rawTotal = itemRows.reduce((a, r) => a + r[1], 0);
    if (itemRows.length > 0 && itemRows[0][1] > 0) {
      out += `> 📌 가장 많이 발생한 항목: **${itemRows[0][0]}** (${itemRows[0][1]}건, 전체의 ${rawTotal ? ((itemRows[0][1] / rawTotal) * 100).toFixed(1) : "0.0"}%)\n\n`;
    }
    return out;
  }
  const catTotals: Record<string, number> = {};
  for (const [cat] of ITEM_CATEGORIES) catTotals[cat] = 0;
  let uncategorized = 0;
  for (const k of Object.keys(m.items)) {
    const cat = itemCategory(k);
    if (cat === CRITICAL_CATEGORY) continue;
    if (cat === "미분류") {
      uncategorized += m.items[k];
      continue;
    }
    catTotals[cat] = (catTotals[cat] || 0) + m.items[k];
  }
  const catRows = ITEM_CATEGORIES.map(([cat]) => [cat, catTotals[cat] || 0] as [string, number]).sort(
    (a, b) => b[1] - a[1],
  );
  for (const domain of ["CS", "직무"] as const) {
    const rows = catRows.filter((r) => CATEGORY_DOMAIN[r[0]] === domain);
    if (!rows.length) continue;
    const domainTotal = rows.reduce((a, r) => a + r[1], 0);
    out += `### [${domain} 영역]\n\n`;
    out += mdTable(["대분류", "건수"], [...rows, ["계", domainTotal]]) + "\n";
  }
  const catTotalSum = catRows.reduce((a, r) => a + r[1], 0);
  if (catRows[0] && catRows[0][1] > 0) {
    out += `> 📌 가장 많이 발생한 영역: **${catRows[0][0]}** (${catRows[0][1]}건, 전체의 ${catTotalSum ? ((catRows[0][1] / catTotalSum) * 100).toFixed(1) : "0.0"}%)\n\n`;
  }
  if (uncategorized > 0) {
    out += `> ⚠ 매핑되지 않은 세부 항목 ${uncategorized}건 있음 — 항목명 확인 필요 [미확인]\n\n`;
  }
  out += buildCategoryChannelMatrix(m);
  const detailRows = Object.entries(m.items)
    .filter(([k, v]) => v > 0 && itemCategory(k) !== CRITICAL_CATEGORY)
    .sort((a, b) => b[1] - a[1]);
  if (detailRows.length > 0) {
    out += `### 세부 항목 (1건 이상만)\n\n`;
    out += mdTable(
      ["세부 항목", "건수"],
      detailRows.map(([k, v]) => [k, v]),
    ) + "\n";
    out += `> 📌 가장 많이 발생한 세부 항목: **${detailRows[0][0]}** (${detailRows[0][1]}건)\n\n`;
  }
  return out;
}

function buildChannelItemAgentSection(m: MonthAgg): string {
  const channels = Object.keys(m.channels);
  if (!channels.length || !Object.keys(m.agents).length) return "";
  let out = `## 4. 채널별 항목 분석\n\n`;
  let any = false;
  for (const c of channels) {
    const counts: Record<string, { count: number; names: Set<string> }> = {};
    for (const a of Object.values(m.agents)) {
      const cd = a.channels[c];
      if (!cd?.items) continue;
      for (const [k, n] of Object.entries(cd.items)) {
        if (n <= 0) continue;
        if (!counts[k]) counts[k] = { count: 0, names: new Set() };
        counts[k].count += n;
        counts[k].names.add(a.name);
      }
    }
    const rows = Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([k, v]) => [k, v.count, [...v.names].join(", ")] as [string, number, string]);
    if (!rows.length) continue;
    any = true;
    const totalCount = rows.reduce((a, r) => a + r[1], 0);
    rows.push(["계", totalCount, ""]);
    out += `### [${c}]\n\n`;
    out += mdTable(
      ["항목", "건수", "해당 인원"],
      rows.map((r) => [r[0], r[1], r[2]]),
    ) + "\n";
  }
  return any ? out : "";
}

function buildMemoKeywordSection(m: MonthAgg): string {
  if (!Object.keys(m.agents).length || !isCsAdminItems(m.items)) return "";
  const catSet = new Set<string>();
  for (const k of Object.keys(m.items)) {
    const cat = itemCategory(k);
    if (cat !== "미분류") catSet.add(cat);
  }
  if (!catSet.size) return "";
  const rows: Array<[string, string, string]> = [];
  for (const a of Object.values(m.agents)) {
    if (integratedStatus(a.channels) !== "C") continue;
    const memos: string[] = [];
    for (const b of Object.values(a.channels)) {
      if (b.memos.length) memos.push(...b.memos);
    }
    if (!memos.length) continue;
    const text = memos.join(" / ");
    const hits: Array<[string, number]> = [];
    for (const cat of catSet) {
      let count = 0;
      for (const variant of categoryKeywordVariants(cat)) {
        let idx = 0;
        while ((idx = text.indexOf(variant, idx)) >= 0) {
          count += 1;
          idx += variant.length;
        }
      }
      if (count > 0) hits.push([cat, count]);
    }
    hits.sort((a, b) => b[1] - a[1]);
    const hitStr = hits.length ? hits.map(([k, c]) => `${k}(${c})`).join(", ") : "(항목명 언급 없음)";
    rows.push([a.name, `${memos.length}건`, hitStr]);
  }
  if (!rows.length) return "";
  let out = `## 5. 코멘트 키워드 분석 (메모 내 대분류명 언급 빈도, Cold만)\n\n`;
  out += mdTable(["이름", "메모 작성 건수", "언급된 대분류(빈도)"], rows) + "\n";
  out += `> 메모 원문을 그대로 옮기지 않고, 대분류명(또는 구두점 뺀 축약형)이 메모에 언급된 횟수만 기계적으로 집계한 결과예요(패턴/빈도 집계, 세부항목 전체 문장은 메모에 그대로 쓰이지 않아 매칭 대상에서 제외). 실제 뉘앙스는 원문을 직접 확인해주세요.\n\n`;
  return out;
}

function channelCell(a: AgentMonth, channel: string): string {
  const b = a.channels[channel];
  if (!b) return "-";
  const s = b.M > 0 ? "M" : b.C > 0 ? "C" : "H";
  return s === "H" ? "🔴" : s === "C" ? "🔵" : "🟢";
}

function buildAgentResultSection(m: MonthAgg, monthsAsc: MonthAgg[]): string {
  if (!Object.keys(m.agents).length) return "";
  const channels = Object.keys(m.channels);
  const headers = ["이름", "팀", ...channels, "피드백건수", "비고"];
  const rows = Object.values(m.agents)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((a) => {
      const st = integratedStatus(a.channels);
      const chanCells = channels.map((c) => channelCell(a, c));
      const feedbackCount = Object.values(a.channels).reduce((n, b) => n + b.H + b.C + b.M, 0);
      const remarks: string[] = [];
      if (st !== "H") {
        remarks.push(...classifyAgentPatterns(monthsAsc, a.key, m.ym).map((l) => l.text));
      }
      const flag = consistencyFlag(a);
      if (flag) remarks.push(`[미확인: 종합결과 불일치 — 건별 ${flag.caseSt} / 종합 ${flag.targetSt}]`);
      return [a.name, a.team || "-", ...chanCells, `${feedbackCount}건`, remarks.join("; ") || "-"];
    });
  let out = `## 7. 상담사별 결과\n\n`;
  out += mdTable(headers, rows) + "\n";
  return out;
}

function buildPatternActionLines(m: MonthAgg, monthsAsc: MonthAgg[]): string[] {
  const lines: string[] = [];
  const streak: string[] = [];
  const newCold: string[] = [];
  const worsened: string[] = [];
  for (const a of Object.values(m.agents)) {
    for (const l of classifyAgentPatterns(monthsAsc, a.key, m.ym)) {
      if (l.type === "연속Cold") streak.push(`${a.name}(${l.n}개월)`);
      else if (l.type === "신규Cold") newCold.push(a.name);
      else if (l.type === "급격악화") worsened.push(a.name);
    }
  }
  if (streak.length) lines.push(`○ 연속 Cold: ${streak.join(", ")} → 코칭 이력 점검 및 방식 재검토 필요`);
  if (newCold.length) lines.push(`○ 신규 Cold: ${newCold.join(", ")} → 조기 개입 필요`);
  if (worsened.length) lines.push(`○ 급격 악화: ${worsened.join(", ")} → 원인 파악 필요`);
  return lines;
}

function buildActionSection(
  patternActionLines: string[],
  deltaActionLine: string,
  prevActionText: string,
): string {
  let out = `## 8. 액션\n\n`;
  if (prevActionText) {
    out += `### 전월 액션 (완료 여부 직접 표시해주세요)\n\n${prevActionText}\n\n`;
  }
  out += `### 이번 달\n\n`;
  out += [...patternActionLines, `○ ${deltaActionLine}`].join("\n") + "\n";
  return out;
}

export function buildMonthlyReportDraft(input: {
  selected: MonthAgg | null;
  prev: MonthAgg | null;
  monthsAsc: MonthAgg[];
  teamFilter: string;
  specialNotes: string;
  prevActionText?: string;
}): string {
  const m = input.selected;
  if (!m) return "데이터가 없어요. 해당 월의 확정 평가 결과가 아직 없습니다.";
  const isTeamScoped = !!(input.teamFilter && input.teamFilter !== "__all__");
  const pc = primaryCounts(m);
  const total = pc.hot + pc.cold + pc.melt;
  const hotRate = ratePct(pc.hot, total).toFixed(1);
  const prev = input.prev;
  let deltaLine: string;
  let deltaActionLine: string;
  if (prev) {
    const ppc = primaryCounts(prev);
    const pTotal = ppc.hot + ppc.cold + ppc.melt;
    const pHotRate = ratePct(ppc.hot, pTotal);
    const delta = (Number.parseFloat(hotRate) - pHotRate).toFixed(1);
    if (Number(delta) > 0) {
      deltaLine = `전월 대비 ${delta}%p 상승`;
      deltaActionLine = "Hot 비중 상승 추세 → 현재 관리 방식 유지, 지속 모니터링";
    } else if (Number(delta) < 0) {
      deltaLine = `전월 대비 ${Math.abs(Number(delta))}%p 하락`;
      deltaActionLine = "Hot 비중 하락 추세 → 코칭 강화 및 원인 항목 집중 점검 필요";
    } else {
      deltaLine = "전월과 동일";
      deltaActionLine = "변동 없음 → 안정적 유지, 정기 모니터링 지속";
    }
  } else {
    deltaLine = "전월 데이터 없음";
    deltaActionLine = "전월 대비 비교 불가 → 다음 달부터 트렌드 확인 가능";
  }

  let out = `■ ${m.ym}${isTeamScoped ? " · " + input.teamFilter : ""} 품질 리포트 초안\n\n`;
  if (isTeamScoped) {
    out += `> ℹ️ 이 보고서는 **${input.teamFilter}** 팀으로만 좁혀서 본 거예요. 전사 기준으로 다시 보려면 위에서 "전사"를 선택하세요.\n\n`;
  }
  out += buildCriticalBadge(m);
  out += buildTopSummary(m, pc, total, hotRate, deltaLine);
  out += `## 0. 평가 특이사항\n\n${(input.specialNotes || "").trim() || "(이번 달 특이사항을 위 입력칸에 적어주세요 — 정책 변경, 평가 유예, 제외 대상 등)"}\n\n`;

  out += `## 1. ${m.ym} 결과 요약\n\n`;
  if (Object.keys(m.channels).length > 0) {
    const chanNames = Object.keys(m.channels);
    const integratedHeader = Object.keys(m.agents).length ? "통합(인원 기준)" : "통합(케이스 합산)";
    const headers = ["구분(채널별=건수)", ...chanNames, integratedHeader];
    const rowHot = ["Hot", ...chanNames.map((c) => m.channels[c].H), pc.hot];
    const rowCold = ["Cold", ...chanNames.map((c) => m.channels[c].C), pc.cold];
    const rowMelt = ["Melt", ...chanNames.map((c) => m.channels[c].M), pc.melt];
    const rowRate = [
      "Hot비중",
      ...chanNames.map((c) => {
        const b = m.channels[c];
        const t = b.H + b.C + b.M;
        return t ? `${((b.H / t) * 100).toFixed(1)}%` : "0.0%";
      }),
      `${hotRate}%`,
    ];
    out += mdTable(headers, [rowHot, rowCold, rowMelt, rowRate]) + "\n";
    if (Object.keys(m.agents).length) {
      out += `> ℹ️ 채널별 칸은 **건수(케이스)** 기준이고, "${integratedHeader}" 칸만 **인원 기준**(한 사람이 여러 채널에 걸쳐 있어도 Cold 하나면 그 사람은 통합 Cold 1명)이에요. 그래서 채널별 칸들을 더해도 통합 칸이랑 정확히 안 맞는 게 정상이에요.\n\n`;
    }
  } else {
    out +=
      mdTable(
        ["구분", "값"],
        [
          ["평가/집계 건수", total],
          ["Hot", pc.hot],
          ["Cold", pc.cold],
          ["Melt", pc.melt],
          ["Hot비중", `${hotRate}%`],
        ],
      ) + "\n";
  }
  out += `> Hot 비중 ${hotRate}% → ${deltaLine}\n\n`;
  out += buildRosterChangeCaption(m, prev);
  out += buildAgentSummarySection(m, input.monthsAsc);
  out += buildRepeatColdSection(m);

  out += `## 2. 최근 월별 추이 (${pc.basis}${isTeamScoped ? ", " + input.teamFilter + " 기준" : ""})\n\n`;
  out += `### 통합\n\n`;
  let prevTrendRate: number | null = null;
  const trendRows = input.monthsAsc.map((mm) => {
    const p = primaryCounts(mm);
    const t = p.hot + p.cold + p.melt;
    const hrNum = t ? (p.hot / t) * 100 : 0;
    const cell = `${hrNum.toFixed(1)}%${rateDeltaSuffix(hrNum, prevTrendRate)}`;
    prevTrendRate = hrNum;
    return [mm.ym, t, p.hot, p.cold, p.melt, cell];
  });
  out += mdTable(["월", "총원/건", "Hot", "Cold", "Melt", "Hot비중"], trendRows) + "\n";
  const allChannelNames = Array.from(
    new Set(input.monthsAsc.flatMap((mm) => Object.keys(mm.channels))),
  );
  for (const c of allChannelNames) {
    let prevChRate: number | null = null;
    const chRows = input.monthsAsc
      .filter((mm) => mm.channels[c])
      .map((mm) => {
        const b = mm.channels[c];
        const t = b.H + b.C + b.M;
        const hrNum = t ? (b.H / t) * 100 : 0;
        const cell = `${hrNum.toFixed(1)}%${rateDeltaSuffix(hrNum, prevChRate)}`;
        prevChRate = hrNum;
        return [mm.ym, t, b.H, b.C, b.M, cell];
      });
    if (!chRows.length) continue;
    out += `### [${c}]\n\n`;
    out += mdTable(["월", "총원/건", "Hot", "Cold", "Melt", "Hot비중"], chRows) + "\n";
  }

  out += buildItemSection(m);
  out += buildChannelItemAgentSection(m);
  out += buildMemoKeywordSection(m);
  out += `## 6. Good/Bad Case\n\n(구체적 상담 사례는 원문 데이터가 없어 자동 생성이 안 돼요 — 직접 작성해주세요)\n\n`;
  out += buildAgentResultSection(m, input.monthsAsc);
  out += buildActionSection(
    buildPatternActionLines(m, input.monthsAsc),
    deltaActionLine,
    input.prevActionText || "",
  );
  return out;
}
