"use client";

import { useState } from "react";
import { ScanSearch, Loader2, AlertCircle, Info } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";
import DamageUpload from "@/components/damage/DamageUpload";
import DamageResultView from "@/components/damage/DamageResultView";

export default function DamagePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [submittedFiles, setSubmittedFiles] = useState<File[]>([]);
  const [result, setResult] = useState<DamageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const submitted = files;
      const fd = new FormData();
      submitted.forEach((f) => fd.append("images", f));
      const res = await fetch("/api/damage", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await describeApiError(res));
      setSubmittedFiles(submitted);
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
          상품 사진을 여러 각도로 올리면 AI가 파손 여부·부위·유형을 판정해요 (중고거래 반품/분쟁용)
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-navy">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>여러 가지의 상품을 올리면, 해당 상품들의 파손 정보를 함께 확인할 수 있어요.</span>
        </p>
      </header>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <DamageUpload files={files} onFiles={setFiles} disabled={loading} />
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={files.length === 0 || loading}
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
