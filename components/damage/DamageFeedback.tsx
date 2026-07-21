"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { DamageResult, FeedbackRating } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";

// 판정 결과에 대한 좋아요/나빠요 + 코멘트. 피드백 케이스의 원본 사진(files)을 재첨부해 저장한다.
export default function DamageFeedback({ result, files }: { result: DamageResult; files: File[] }) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(chosen: FeedbackRating) {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("rating", chosen);
      fd.append("comment", comment);
      fd.append("result", JSON.stringify(result));
      // files는 통합 순서(신청인 먼저) — claimantCount로 분리해 재첨부
      files.forEach((f, i) => fd.append(i < result.claimantCount ? "claimantImages" : "respondentImages", f));
      const res = await fetch("/api/damage/feedback", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await describeApiError(res));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "피드백 저장에 실패했어요");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        피드백 고마워요! 판정 품질을 개선하는 데 쓸게요.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700">이 판정이 도움이 됐나요?</h3>
      <p className="mt-1 text-xs text-gray-400">
        주신 피드백을 바탕으로 판정 품질을 업데이트할 예정이에요 🙌
      </p>

      <div className="mt-3 flex items-center gap-2">
        {(
          [
            { key: "good", label: "도움돼요", Icon: ThumbsUp },
            { key: "bad", label: "아쉬워요", Icon: ThumbsDown },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setRating(key)}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
              rating === key
                ? key === "good"
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-red-300 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {rating && (
        <div className="mt-3 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={loading}
            rows={2}
            maxLength={2000}
            placeholder={rating === "bad" ? "어떤 점이 아쉬웠는지 적어주면 개선에 큰 도움이 돼요 (선택)" : "코멘트 (선택)"}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-navy focus:outline-none"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-line">{error}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => submit(rating)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            피드백 보내기
          </button>
        </div>
      )}
    </div>
  );
}
