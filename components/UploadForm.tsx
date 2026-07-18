"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";
import ThresholdSlider from "./ThresholdSlider";
import UploadDropzone from "./UploadDropzone";

export default function UploadForm({
  onResult,
}: {
  onResult: (r: EvaluationResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [minSilenceSec, setMinSilenceSec] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("minSilenceSec", String(minSilenceSec));
      const res = await fetch("/api/evaluate", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await describeApiError(res));
      onResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가에 실패했어요");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <UploadDropzone file={file} onFile={setFile} disabled={loading} />
      <ThresholdSlider value={minSilenceSec} onChange={setMinSilenceSec} disabled={loading} />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!file || loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            평가 중… (파일 길이에 따라 수십 초~수 분)
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            품질 평가 시작
          </>
        )}
      </button>
    </form>
  );
}
