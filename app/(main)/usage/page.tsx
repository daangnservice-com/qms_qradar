"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Activity, BarChart3, Clock, Users, ChevronDown, ChevronRight } from "lucide-react";
import { isAdmin } from "@/lib/adminEmails";
import type { UsageStats } from "@/lib/bigquery";

// 경로 → 화면 이름(표시용). 새 페이지가 생기면 여기에 추가.
const PATH_LABELS: Record<string, string> = {
  "/": "콜 품질 평가",
  "/damage": "파손 판별",
  "/usage": "사용량",
};
const pathLabel = (p: string) => PATH_LABELS[p] ?? p;

const PERIODS = [
  { days: 7, label: "최근 7일" },
  { days: 30, label: "최근 30일" },
  { days: 90, label: "최근 90일" },
];

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(d);
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">{value}</p>
    </div>
  );
}

// 일별 접속량 막대 그래프(경량 SVG, 외부 라이브러리 없음).
function DailyBars({ daily }: { daily: UsageStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.views));
  if (daily.length === 0) return <p className="py-8 text-center text-sm text-gray-400">데이터가 없어요</p>;
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 160 }}>
      {daily.map((d) => (
        <div key={d.date} className="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-1" title={`${d.date} · ${d.views}회 · ${d.users}명`}>
          <div className="w-full rounded-t bg-navy/80 transition-all hover:bg-navy" style={{ height: `${(d.views / max) * 130}px` }} />
          <span className="whitespace-nowrap text-[9px] text-gray-400">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function UserRow({ u }: { u: UsageStats["byUser"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{u.email}</span>
        <span className="shrink-0 text-sm tabular-nums text-gray-500">{u.views}회</span>
        <span className="hidden shrink-0 text-xs tabular-nums text-gray-400 sm:inline">{fmtDateTime(u.lastSeen)}</span>
      </button>
      {open && (
        <div className="bg-gray-50/60 px-10 py-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">화면별 접속</p>
          <div className="flex flex-wrap gap-1.5">
            {u.paths.map((p) => (
              <span key={p.path} className="rounded-md bg-white px-2 py-1 text-xs text-gray-600 ring-1 ring-gray-200">
                {pathLabel(p.path)} <span className="font-semibold text-navy">{p.views}</span>
              </span>
            ))}
            {u.paths.length === 0 && <span className="text-xs text-gray-400">기록 없음</span>}
          </div>
          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">최근 마지막 접속</p>
          <p className="text-xs text-gray-600">{fmtDateTime(u.lastSeen)}</p>
        </div>
      )}
    </div>
  );
}

export default function UsagePage() {
  const { data: session, status } = useSession();
  const admin = isAdmin(session?.user?.email);

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/stats/usage?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "접근 권한이 없어요." : `조회 실패 (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: UsageStats) => {
        if (!cancelled) setStats(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "조회에 실패했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [admin, days]);

  const topPaths = useMemo(() => stats?.byPath ?? [], [stats]);
  const maxPathViews = Math.max(1, ...topPaths.map((p) => p.views));

  if (status === "loading") {
    return <div className="mx-auto w-full max-w-5xl px-6 py-8 text-sm text-gray-400">불러오는 중…</div>;
  }
  if (!admin) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-gray-500">이 페이지는 관리자만 볼 수 있어요.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <BarChart3 className="h-5 w-5 text-navy" />
            사용량
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">누가 · 어떤 화면을 · 언제 접속했는지 기록해요 (관리자 전용)</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setDays(p.days)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                days === p.days ? "bg-white text-navy shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      {loading && !stats && <p className="mt-6 text-sm text-gray-400">불러오는 중…</p>}

      {stats && (
        <div className={`mt-6 space-y-6 ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard icon={Activity} label="총 조회수" value={stats.totalViews.toLocaleString()} />
            <StatCard icon={Users} label="접속 사용자" value={`${stats.totalUsers}명`} />
            <StatCard icon={Clock} label="기간" value={`${days}일`} />
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">일별 접속량</h2>
            <DailyBars daily={stats.daily} />
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">화면별 접속</h2>
            {topPaths.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">데이터가 없어요</p>
            ) : (
              <div className="space-y-2">
                {topPaths.map((p) => (
                  <div key={p.path} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm text-gray-700">{pathLabel(p.path)}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                      <div className="h-full rounded bg-brand/80" style={{ width: `${(p.views / maxPathViews) * 100}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums text-gray-500">
                      {p.views}회 · {p.users}명
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-5 py-3.5 text-sm font-semibold text-gray-700">사용자별 접속</h2>
            {stats.byUser.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">데이터가 없어요</p>
            ) : (
              <div>
                {stats.byUser.map((u) => (
                  <UserRow key={u.email} u={u} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
