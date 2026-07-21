"use client";

import { useState } from "react";
import { ScanSearch, Loader2, AlertCircle, Info } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";
import DamageUpload from "@/components/damage/DamageUpload";
import DamageResultView from "@/components/damage/DamageResultView";

const MAX_PER_PARTY = 5;

export default function DamagePage() {
  const [claimantFiles, setClaimantFiles] = useState<File[]>([]);
  const [respondentFiles, setRespondentFiles] = useState<File[]>([]);
  // 통합 순서(신청인 먼저)로 제출한 사진 — 결과 뷰의 photoIndex와 정렬을 맞춘다
  const [submittedFiles, setSubmittedFiles] = useState<File[]>([]);
  const [result, setResult] = useState<DamageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalFiles = claimantFiles.length + respondentFiles.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (totalFiles === 0) return;
    setLoading(true);
    setError(null);
    try {
      const ordered = [...claimantFiles, ...respondentFiles];
      const fd = new FormData();
      claimantFiles.forEach((f) => fd.append("claimantImages", f));
      respondentFiles.forEach((f) => fd.append("respondentImages", f));
      const res = await fetch("/api/damage", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await describeApiError(res));
      setSubmittedFiles(ordered);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "판별에 실패했어요");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <header className="border-b border-gray-100 pb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <ScanSearch className="h-5 w-5 text-navy" />
          파손 판별
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          신청인·피신청인이 제출한 사진을 각각 올리면 AI가 양측을 비교해 파손 여부·부위·유형을 판정해요 (분쟁조정용)
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-navy">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>한쪽만 올려도 판정은 가능해요. 양측을 함께 올리면 사진 간 차이·불일치까지 짚어줘요.</span>
        </p>
      </header>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <span className="inline-flex h-5 items-center rounded-md bg-navy/10 px-2 text-xs font-bold text-navy">신청인</span>
              파손을 주장하는 쪽
            </div>
            <DamageUpload
              files={claimantFiles}
              onFiles={setClaimantFiles}
              disabled={loading}
              max={MAX_PER_PARTY}
              label="신청인 사진"
              hint={`jpg · png · webp / 최대 ${MAX_PER_PARTY}장`}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <span className="inline-flex h-5 items-center rounded-md bg-gray-200 px-2 text-xs font-bold text-gray-600">피신청인</span>
              반박하는 쪽
            </div>
            <DamageUpload
              files={respondentFiles}
              onFiles={setRespondentFiles}
              disabled={loading}
              max={MAX_PER_PARTY}
              label="피신청인 사진"
              hint={`jpg · png · webp / 최대 ${MAX_PER_PARTY}장`}
            />
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={totalFiles === 0 || loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              판별 중…
            </>
          ) : (
            <>
              <ScanSearch className="h-4 w-4" />
              파손 판별 시작
            </>
          )}
        </button>
      </form>

      {result && <DamageResultView result={result} files={submittedFiles} />}
    </div>
  );
}
