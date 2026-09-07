import { Radar, ListChecks, LineChart, FileSearch, PieChart, BookOpen } from "lucide-react";

const NAV = [
  { label: "리포트", icon: LineChart },
  { label: "평가 현황", icon: ListChecks, active: true },
  { label: "케이스 상세", icon: FileSearch },
  { label: "월별 집계", icon: PieChart },
];

/** 로그인 없이 화면만 보여 주기 위한 정적 사이드바. 링크 없음. */
export function EvalStatusRefSidebar() {
  return (
    <aside className="seed-sidebar flex w-[248px] shrink-0 flex-col">
      <div className="flex h-[64px] items-center gap-2.5 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--brand)] text-white">
          <Radar className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <span className="block truncate text-[15px] font-bold tracking-tight text-[var(--fg-primary)]">QRadar</span>
          <span className="block truncate text-[11px] font-medium text-[var(--fg-tertiary)]">콜 품질 평가</span>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
        <div>
          <div className="mb-1.5 px-3 text-[11px] font-bold text-[var(--fg-tertiary)]">품질평가</div>
          <div className="flex flex-col gap-0.5">
            {NAV.map(({ label, icon: Icon, active }) => (
              <span
                key={label}
                className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13px] ${
                  active
                    ? "bg-[var(--brand-subtle)] font-bold text-[var(--brand)]"
                    : "font-medium text-[var(--fg-secondary)]"
                }`}
              >
                <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2.2 : 1.9} />
                <span className="truncate">{label}</span>
              </span>
            ))}
          </div>
        </div>
      </nav>
      <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2">
        <div className="mb-1 px-3 text-[11px] font-bold text-[var(--fg-tertiary)]">도움말</div>
        <span className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13px] font-medium text-[var(--fg-secondary)]">
          <BookOpen className="h-[17px] w-[17px] shrink-0" strokeWidth={1.9} />
          <span className="truncate">이용 설명서</span>
        </span>
      </div>
    </aside>
  );
}
