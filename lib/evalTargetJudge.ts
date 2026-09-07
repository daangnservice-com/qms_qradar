/** 품질평가 대상자 자동 판정 — GAS roster.js `judgeTarget_` 이식. */

import { calendarMonthOf } from "./distSet";

export type EvalJudgeKind = "target" | "excluded";

export type EvalJudgeInput = {
  status?: string;
  level?: string;
  hireDate?: Date | string | null;
  convertDate?: Date | string | null;
  exitDate?: Date | string | null;
  part?: string;
  evalMonth: string; // YYYY-MM
};

export type EvalJudgeResult = {
  kind: EvalJudgeKind;
  notes: string[];
};

const EXCLUDED_TEAMS = new Set(["피플팀", "성장문화팀", "X팀"]);

export function isExcludedTeam(teamName: string | null | undefined): boolean {
  return EXCLUDED_TEAMS.has(String(teamName || "").trim());
}

export function parseEvalMonth(ym: string): { y: number; m: number } | null {
  const cal = calendarMonthOf(ym);
  const m = cal.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + (d.getUTCMonth() + 1);
}

export function levelNum(level: string | null | undefined): number | null {
  const m = String(level || "").match(/L\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 재직자 한 명 → 해당 월 자동 판정. 수동 조정이 있으면 최종은 수동 우선. */
export function judgeTarget(input: EvalJudgeInput): EvalJudgeResult {
  const ym = parseEvalMonth(input.evalMonth);
  if (!ym) return { kind: "excluded", notes: ["평가월 형식 오류"] };

  const notes: string[] = [];
  let target = true;
  const evalIdx = ym.y * 12 + ym.m;
  const level = String(input.level || "");
  const status = String(input.status || "").trim();
  const part = String(input.part || "");

  const ln = levelNum(level);
  if (ln === null) {
    target = false;
    notes.push(`평가 레벨 아님(${level || "미입력"})`);
  } else if (ln >= 5) {
    target = false;
    notes.push("L5 이상");
  }

  if (level.includes("L2") && level.includes("단기")) {
    target = false;
    notes.push("단기 계약");
  }

  const exitDate = toDate(input.exitDate);
  if (status === "퇴사예정") {
    if (exitDate) {
      const exitIdx = monthIndex(exitDate);
      if (exitIdx < evalIdx) {
        target = false;
        notes.push("퇴사예정(평가월 이전 퇴사)");
      } else if (exitIdx === evalIdx) {
        notes.push("퇴사월 포함");
      } else {
        notes.push(`퇴사예정(${fmtDate(exitDate)})`);
      }
    } else {
      notes.push("퇴사예정(퇴사일 미입력)");
    }
  }

  const hireDate = toDate(input.hireDate);
  if (hireDate) {
    const hireIdx = monthIndex(hireDate);
    if (evalIdx < hireIdx + 2) {
      target = false;
      notes.push("신규 입사 유예기간");
    }
  }

  const convDate = toDate(input.convertDate);
  if (convDate && level.includes("L2")) {
    const convIdx = monthIndex(convDate);
    if (evalIdx < convIdx + 2) {
      target = false;
      notes.push("계약 전환자");
    }
  }

  if (part.includes("모니터링")) {
    target = false;
    notes.push("모니터링 파트 제외");
  }

  return { kind: target ? "target" : "excluded", notes };
}

export function finalJudge(auto: EvalJudgeKind, manual: string | null | undefined): EvalJudgeKind {
  const m = String(manual || "").replace(/[✅❌\s]/g, "");
  if (m === "대상") return "target";
  if (m === "제외") return "excluded";
  return auto;
}
