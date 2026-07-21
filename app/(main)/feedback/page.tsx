"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MessageSquareHeart, MessagesSquare, ThumbsUp, ThumbsDown, ChevronDown, ChevronRight, Trash2, Loader2 } from "lucide-react";
import { isAdmin } from "@/lib/adminEmails";
import type { FeedbackStats, DamageFeedbackRow, ChatStats, ChatTurnRow } from "@/lib/types";
import { PARTY_LABEL } from "@/lib/types";

const PERIODS = [
  { days: 30, label: "최근 30일" },
  { days: 90, label: "최근 90일" },
  { days: 180, label: "최근 180일" },
];

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
  }).format(d);
}

const ratio = (good: number, bad: number) => {
  const t = good + bad;
  return t === 0 ? "—" : `${Math.round((good / t) * 100)}%`;
};

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <span className="text-xs font-medium text-gray-400">{label}</span>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${tone === "good" ? "text-green-600" : tone === "bad" ? "text-red-500" : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

function FeedbackRow({ r, onDelete }: { r: DamageFeedbackRow; onDelete: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const claimant = r.imagePaths.slice(0, r.claimantCount);
  const respondent = r.imagePaths.slice(r.claimantCount);

  async function handleDelete() {
    if (!confirm("이 피드백을 삭제할까요? 저장된 사진도 함께 삭제돼요.")) return;
    setDeleting(true);
    try {
      await onDelete(r.feedbackId);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50">
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${r.rating === "good" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
          {r.rating === "good" ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
          {r.rating === "good" ? "도움" : "아쉬움"}
        </span>
        <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">{r.verdict}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{r.comment || <span className="text-gray-400">코멘트 없음</span>}</span>
        <span className="hidden shrink-0 text-xs text-gray-400 sm:inline">{r.promptVersion}</span>
        <span className="hidden shrink-0 text-xs tabular-nums text-gray-400 md:inline">{fmtDateTime(r.ts)}</span>
      </button>
      {open && (
        <div className="space-y-3 bg-gray-50/60 px-10 py-4 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            <span>제출자: {r.userEmail || "—"}</span>
            <span>신뢰도: {Math.round(r.confidence * 100)}%</span>
            <span>모델: {r.model}</span>
            <span>프롬프트: {r.promptVersion}</span>
          </div>
          {r.summary && (<p><span className="font-semibold text-gray-600">종합 소견</span> · <span className="text-gray-700">{r.summary}</span></p>)}
          {r.comparison && (<p><span className="font-semibold text-gray-600">양측 비교</span> · <span className="text-gray-700">{r.comparison}</span></p>)}
          {r.comment && (<p className="rounded-lg bg-white p-3 text-gray-700 ring-1 ring-gray-200"><span className="font-semibold">피드백</span> · {r.comment}</p>)}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              삭제
            </button>
          </div>
          {r.imagePaths.length > 0 ? (
            <div className="space-y-2">
              {([["claimant", claimant], ["respondent", respondent]] as const).filter(([, arr]) => arr.length > 0).map(([party, arr]) => (
                <div key={party}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{PARTY_LABEL[party]} 제출 사진</p>
                  <div className="flex flex-wrap gap-2">
                    {arr.map((path) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={path} src={`/api/stats/feedback/image?path=${encodeURIComponent(path)}`} alt="피드백 사진" className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">저장된 사진 없음(보관 기간 만료 또는 미첨부)</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChatTurn({ r, onDelete }: { r: ChatTurnRow; onDelete: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("이 챗봇 질문·답변을 삭제할까요?")) return;
    setDeleting(true);
    try {
      await onDelete(r.messageId);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50">
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
        {r.rating ? (
          <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-bold ${r.rating === "good" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
            {r.rating === "good" ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
          </span>
        ) : (
          <span className="inline-flex h-5 w-6 shrink-0 items-center justify-center text-xs text-gray-300">—</span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{r.question || <span className="text-gray-400">질문 없음</span>}</span>
        <span className="hidden shrink-0 text-xs tabular-nums text-gray-400 md:inline">{fmtDateTime(r.ts)}</span>
      </button>
      {open && (
        <div className="space-y-2 bg-gray-50/60 px-10 py-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            <span>질문자: {r.userEmail || "—"}</span>
            <span>판정 맥락: {r.verdict || "—"}</span>
            <span>프롬프트: {r.promptVersion || "—"}</span>
          </div>
          <p className="rounded-lg bg-white p-3 text-gray-700 ring-1 ring-gray-200"><span className="font-semibold">Q</span> · {r.question}</p>
          <p className="whitespace-pre-line rounded-lg bg-white p-3 text-gray-700 ring-1 ring-gray-200"><span className="font-semibold">A</span> · {r.answer}</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedbackPage() {
  const { data: session, status } = useSession();
  const admin = isAdmin(session?.user?.email);

  const [days, setDays] = useState(90);
  const [reloadKey, setReloadKey] = useState(0);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [chat, setChat] = useState<ChatStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/stats/feedback?days=${days}`).then((res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "접근 권한이 없어요." : `조회 실패 (HTTP ${res.status})`);
        return res.json() as Promise<FeedbackStats>;
      }),
      fetch(`/api/stats/chat?days=${days}`).then((res) => (res.ok ? (res.json() as Promise<ChatStats>) : null)),
    ])
      .then(([fb, ch]) => { if (!cancelled) { setStats(fb); setChat(ch); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "조회에 실패했어요."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [admin, days, reloadKey]);

  async function handleDelete(feedbackId: string) {
    const res = await fetch("/api/stats/feedback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackId }),
    });
    if (!res.ok) {
      alert("삭제에 실패했어요. 잠시 후 다시 시도해줘.");
      return;
    }
    // 즉시 목록에서 제거(낙관적) + 서버 재조회로 집계 갱신
    setStats((s) => (s ? { ...s, recent: s.recent.filter((r) => r.feedbackId !== feedbackId) } : s));
    setReloadKey((k) => k + 1);
  }

  async function handleChatDelete(messageId: string) {
    const res = await fetch("/api/stats/chat", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    if (!res.ok) {
      alert("삭제에 실패했어요. 잠시 후 다시 시도해줘.");
      return;
    }
    setChat((c) => (c ? { ...c, recent: c.recent.filter((r) => r.messageId !== messageId) } : c));
    setReloadKey((k) => k + 1);
  }

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
            <MessageSquareHeart className="h-5 w-5 text-navy" />
            피드백
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">파손 판별 결과에 대한 좋아요/나빠요 · 프롬프트 버전별 품질 (관리자 전용)</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" onClick={() => setDays(p.days)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${days === p.days ? "bg-white text-navy shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      {loading && !stats && <p className="mt-6 text-sm text-gray-400">불러오는 중…</p>}

      {stats && (
        <div className={`mt-6 space-y-6 ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="총 피드백" value={stats.total.toLocaleString()} />
            <StatCard label="도움돼요" value={stats.good} tone="good" />
            <StatCard label="아쉬워요" value={stats.bad} tone="bad" />
            <StatCard label="만족도" value={ratio(stats.good, stats.bad)} />
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">프롬프트 버전별 만족도</h2>
            {stats.byVersion.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">데이터가 없어요</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                      <th className="py-2 font-medium">버전</th>
                      <th className="py-2 text-right font-medium">도움</th>
                      <th className="py-2 text-right font-medium">아쉬움</th>
                      <th className="py-2 text-right font-medium">만족도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byVersion.map((v) => (
                      <tr key={v.promptVersion} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 font-medium text-gray-700">{v.promptVersion || "—"}</td>
                        <td className="py-2 text-right tabular-nums text-green-600">{v.good}</td>
                        <td className="py-2 text-right tabular-nums text-red-500">{v.bad}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-gray-800">{ratio(v.good, v.bad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-5 py-3.5 text-sm font-semibold text-gray-700">최근 피드백</h2>
            {stats.recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">아직 피드백이 없어요</p>
            ) : (
              <div>{stats.recent.map((r) => <FeedbackRow key={r.feedbackId} r={r} onDelete={handleDelete} />)}</div>
            )}
          </section>

          {chat && (
            <section className="rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <MessagesSquare className="h-4 w-4 text-navy" />
                  챗봇 질문·답변
                </h2>
                <span className="text-xs text-gray-400">
                  총 {chat.totalTurns.toLocaleString()}턴 · 답변 평가 👍 {chat.good} / 👎 {chat.bad}
                </span>
              </div>
              {chat.recent.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">아직 챗봇 대화가 없어요</p>
              ) : (
                <div>{chat.recent.map((r) => <ChatTurn key={r.messageId} r={r} onDelete={handleChatDelete} />)}</div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
