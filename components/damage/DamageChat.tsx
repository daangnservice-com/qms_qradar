"use client";

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Loader2, AlertCircle, X, ThumbsUp, ThumbsDown } from "lucide-react";
import type { DamageResult, FeedbackRating } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";

const STARTERS = ["왜 이렇게 판단했어?", "가장 확실한 파손 근거는?", "불확실한 부분이 있어?"];

type UiMsg = { role: "user" | "model"; text: string; id?: string; rating?: FeedbackRating };

// **굵게** 인라인 렌더(경량). 닫히지 않은 ** 는 그대로 둔다.
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((seg, i) => {
    const m = seg.match(/^\*\*([^*\n]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{seg}</span>;
  });
}

// 줄 단위로 불릿(`* `/`- `)·굵게를 렌더. react-markdown 없이 챗봇 답변에 흔한 서식만 처리.
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*[*-]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="select-none text-gray-400">•</span>
              <span>{renderInline(bullet[1])}</span>
            </div>
          );
        }
        return <div key={i}>{line ? renderInline(line) : " "}</div>;
      })}
    </>
  );
}

// 판정 결과에 대해 묻는 멀티턴 챗봇. 우측 하단 플로팅 버튼으로 열고,
// 원본 사진(files)을 매 요청 재첨부해 시각 재검토. 답변별 👍/👎 평가 가능.
export default function DamageChat({ result, files }: { result: DamageResult; files: File[] }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    const userMsg: UiMsg = { role: "user", text: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("message", q);
      fd.append("result", JSON.stringify(result));
      fd.append("history", JSON.stringify(history));
      files.forEach((f, i) => fd.append(i < result.claimantCount ? "claimantImages" : "respondentImages", f));
      const res = await fetch("/api/damage/chat", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await describeApiError(res));
      const { reply, messageId } = (await res.json()) as { reply: string; messageId: string };
      setMessages((m) => [...m, { role: "model", text: reply, id: messageId }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "답변 생성에 실패했어요");
      // 실패한 질문은 되돌린다 — 남겨두면 다음 요청의 history가 user로 끝나
      // Gemini 멀티턴 role 교대가 깨져(연속 user) 이후 모든 메시지가 실패한다.
      setMessages((prev) => prev.filter((m) => m !== userMsg));
      setInput(q); // 재시도 편의
    } finally {
      setLoading(false);
    }
  }

  async function rate(id: string, rating: FeedbackRating) {
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, rating } : msg))); // 낙관적
    try {
      await fetch("/api/damage/chat/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, rating }),
      });
    } catch {
      /* 평가 저장 실패는 조용히 무시(UX 우선) */
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-3 flex h-[70vh] max-h-[560px] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <MessagesSquare className="h-4 w-4 text-navy" />
              판정에 대해 물어보기
            </h3>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="pt-2 text-xs text-gray-400">사진을 다시 살펴보며 답해요. 판단 근거가 궁금하면 물어보세요.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[88%] space-y-1 rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-navy text-white" : "bg-gray-100 text-gray-800"}`}>
                  {m.role === "model" ? <RichText text={m.text} /> : m.text}
                </div>
                {m.role === "model" && m.id && (
                  <div className="mt-1 flex items-center gap-1 pl-1">
                    <span className="text-[11px] text-gray-400">답변이 도움됐나요?</span>
                    <button type="button" onClick={() => rate(m.id!, "good")} aria-label="좋아요"
                      className={`rounded-md p-1 transition hover:bg-gray-100 ${m.rating === "good" ? "text-green-600" : "text-gray-400"}`}>
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => rate(m.id!, "bad")} aria-label="나빠요"
                      className={`rounded-md p-1 transition hover:bg-gray-100 ${m.rating === "bad" ? "text-red-500" : "text-gray-400"}`}>
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-3.5 py-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                사진을 살펴보는 중…
              </div>
            )}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} disabled={loading}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-navy/40 hover:text-navy disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="whitespace-pre-line">{error}</span>
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t border-gray-100 px-3 py-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
              placeholder="예: 신청인 사진 2번의 긁힘이 진짜야?"
              className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-navy focus:outline-none disabled:opacity-60" />
            <button type="submit" disabled={loading || !input.trim()} aria-label="보내기"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sm transition hover:brightness-95 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-navy px-5 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:bg-navy-hover"
      >
        {open ? <X className="h-5 w-5" /> : <MessagesSquare className="h-5 w-5" />}
        {!open && "판정에 대해 물어보기"}
      </button>
    </div>
  );
}
